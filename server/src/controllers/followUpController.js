import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { hasPermission } from '../services/userService.js';
import {
  getUserDataScope,
  buildFollowUpScopeWhere,
  canAccessFollowUp,
  canAssignFollowUpTo,
  canAccessLead,
  canAccessCustomer,
} from '../services/access.js';
import {
  FOLLOW_UP_TYPES,
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_STATUSES,
  activityLabel,
  insertTimelineActivity,
  notifyUser,
  runFollowUpReminders,
} from '../services/followUpService.js';

const FOLLOW_UP_SELECT = `
  SELECT f.*, u.name AS assigned_name, cr.name AS created_by_name, cb.name AS completed_by_name,
         t.name AS team_name, tl.company_name AS lead_name, tc.name AS customer_name
  FROM follow_ups f
  LEFT JOIN users u ON u.id = f.assigned_to
  LEFT JOIN users cr ON cr.id = f.created_by
  LEFT JOIN users cb ON cb.id = f.completed_by
  LEFT JOIN teams t ON t.id = f.team_id
  LEFT JOIN leads tl ON tl.id = f.lead_id
  LEFT JOIN customers tc ON tc.id = f.customer_id
`;

const SORTABLE = {
  followUpDate: 'f.follow_up_date',
  followUpTime: 'f.follow_up_time',
  createdAt: 'f.created_at',
  priority: 'f.priority',
  status: 'f.status',
  activityType: 'f.activity_type',
  contactPerson: 'f.contact_person',
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function followUpToJson(f, today = todayStr()) {
  const overdue = f.status === 'Pending' && !!f.follow_up_date && f.follow_up_date < today;
  return {
    id: f.id,
    companyId: f.company_id,
    targetType: f.target_type,
    leadId: f.lead_id,
    customerId: f.customer_id,
    targetId: f.lead_id ?? f.customer_id,
    targetName: f.lead_name ?? f.customer_name ?? null,
    contactPerson: f.contact_person,
    activityType: f.activity_type,
    followUpDate: f.follow_up_date,
    followUpTime: f.follow_up_time,
    priority: f.priority,
    status: f.status,
    displayStatus: overdue ? 'Overdue' : f.status,
    overdue,
    assignedTo: f.assigned_to,
    assignedName: f.assigned_name || null,
    teamId: f.team_id,
    teamName: f.team_name || null,
    notes: f.notes,
    nextAction: f.next_action,
    nextFollowUpDate: f.next_follow_up_date,
    completedAt: f.completed_at,
    completedByName: f.completed_by_name || null,
    rescheduledFrom: f.rescheduled_from,
    createdBy: f.created_by,
    createdByName: f.created_by_name || null,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}

function scopedFollowUpWhere(scope, extraClauses = [], extraParams = [], alias = 'f') {
  const { where, params } = buildFollowUpScopeWhere(scope, alias);
  const clauses = [...extraClauses, `${alias}.deleted_at IS NULL`];
  const whereSql = where ? `${where} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;
  return { where: whereSql, params: [...params, ...extraParams] };
}

/** Load + authorize the target entity for a follow-up, returning { targetType, targetId, companyId, contactPerson }. */
function resolveTarget(db, req, scope, { targetType, targetId }) {
  if (targetType === 'lead') {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(targetId);
    if (!lead || lead.deleted_at) throw notFound('Lead not found');
    if (!canAccessLead(scope, lead)) throw forbidden('You cannot access this lead');
    return { targetType: 'lead', targetId: lead.id, companyId: lead.company_id, contactPerson: lead.contact_person };
  }
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(targetId);
  if (!customer || customer.deleted_at) throw notFound('Customer not found');
  if (!canAccessCustomer(scope, customer)) throw forbidden('You cannot access this customer');
  return { targetType: 'customer', targetId: customer.id, companyId: customer.company_id, contactPerson: customer.contact_person };
}

/** Resolve assignee/team for a follow-up create/update/reschedule. */
function resolveAssignment(db, req, scope, companyId, assignedTo) {
  let assignedToVal = assignedTo ?? null;
  if (assignedToVal != null) {
    const target = db.prepare('SELECT id, company_id, team_id FROM users WHERE id = ?').get(assignedToVal);
    if (!target || target.company_id !== companyId) throw badRequest('Invalid assignee');
    if (assignedToVal !== req.user.id && !hasPermission(req.user, 'followups:assign')) {
      throw forbidden('You do not have permission to assign follow-ups to others');
    }
    if (!canAssignFollowUpTo(scope, target)) {
      throw forbidden('You can only assign follow-ups within your scope');
    }
  }
  const teamIdVal = assignedToVal
    ? db.prepare('SELECT team_id FROM users WHERE id = ?').get(assignedToVal)?.team_id ?? null
    : null;
  return { assignedToVal, teamIdVal };
}

function notifyAssignee(db, req, followUpId, assignedToVal, companyId) {
  if (assignedToVal && assignedToVal !== req.user.id) {
    notifyUser(db, {
      companyId,
      userId: assignedToVal,
      title: 'New follow-up assigned',
      body: `A follow-up has been assigned to you.`,
      link: `/follow-ups/${followUpId}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const listFollowUps = asyncHandler(async (req, res) => {
  const db = getDb();
  const {
    page, pageSize, search, status, activityType, priority, assignedTo, teamId,
    targetType, targetId, dateFrom, dateTo, sort, order,
  } = req.query;
  const scope = getUserDataScope(req.user);
  const today = todayStr();

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(f.contact_person LIKE ? OR f.notes LIKE ? OR f.next_action LIKE ? OR tl.company_name LIKE ? OR tc.name LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (status === 'Overdue') {
    clauses.push("f.status = 'Pending' AND f.follow_up_date < ?");
    params.push(today);
  } else if (status) {
    clauses.push('f.status = ?');
    params.push(status);
  }
  if (activityType) {
    clauses.push('f.activity_type = ?');
    params.push(activityType);
  }
  if (priority) {
    clauses.push('f.priority = ?');
    params.push(priority);
  }
  if (assignedTo) {
    clauses.push('f.assigned_to = ?');
    params.push(assignedTo);
  }
  if (teamId) {
    clauses.push('f.team_id = ?');
    params.push(teamId);
  }
  if (targetType && targetId) {
    clauses.push(targetType === 'lead' ? 'f.lead_id = ?' : 'f.customer_id = ?');
    params.push(targetId);
  } else if (targetType) {
    clauses.push('f.target_type = ?');
    params.push(targetType);
  }
  if (dateFrom) {
    clauses.push('f.follow_up_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('f.follow_up_date <= ?');
    params.push(dateTo);
  }

  const { where, params: whereParams } = scopedFollowUpWhere(scope, clauses, params, 'f');

  const sortColumn = SORTABLE[sort] || 'f.follow_up_date';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM follow_ups f LEFT JOIN leads tl ON tl.id = f.lead_id LEFT JOIN customers tc ON tc.id = f.customer_id ${where}`).get(...whereParams).c;
  const rows = db
    .prepare(
      `${FOLLOW_UP_SELECT} ${where} ORDER BY ${sortColumn} ${sortOrder}, f.id DESC LIMIT ? OFFSET ?`
    )
    .all(...whereParams, pageSize, (page - 1) * pageSize);

  return paginated(res, rows.map((r) => followUpToJson(r, today)), { page, pageSize, total });
});

export const getFollowUp = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare(`${FOLLOW_UP_SELECT} WHERE f.id = ?`).get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Follow-up not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessFollowUp(scope, row)) throw forbidden('You cannot access this follow-up');

  return ok(res, followUpToJson(row));
});

export const followUpMeta = asyncHandler(async (_req, res) => {
  return ok(res, {
    types: FOLLOW_UP_TYPES,
    priorities: FOLLOW_UP_PRIORITIES,
    statuses: [...FOLLOW_UP_STATUSES, 'Overdue'],
  });
});

export const followUpDashboard = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const today = todayStr();
  const { where, params } = scopedFollowUpWhere(scope, [], []);

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'Pending' AND follow_up_date = ? THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN status = 'Pending' AND follow_up_date > ? THEN 1 ELSE 0 END) AS upcoming,
         SUM(CASE WHEN status = 'Pending' AND follow_up_date < ? THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending
       FROM follow_ups f ${where}`
    )
    .get(today, today, today, ...params);

  const byStatus = [
    { status: 'Pending', count: stats.pending || 0 },
    { status: 'Completed', count: stats.completed || 0 },
    { status: 'Rescheduled', count: db.prepare(`SELECT COUNT(*) AS c FROM follow_ups f ${where} AND f.status = 'Rescheduled'`).get(...params).c },
    { status: 'Cancelled', count: db.prepare(`SELECT COUNT(*) AS c FROM follow_ups f ${where} AND f.status = 'Cancelled'`).get(...params).c },
    { status: 'Overdue', count: stats.overdue || 0 },
  ];

  const byType = FOLLOW_UP_TYPES.map((type) => {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM follow_ups f ${where} AND f.activity_type = ?`).get(...params, type);
    return { type, count: r.c };
  });

  return ok(res, {
    total: stats.total || 0,
    today: stats.today || 0,
    upcoming: stats.upcoming || 0,
    overdue: stats.overdue || 0,
    completed: stats.completed || 0,
    pending: stats.pending || 0,
    byStatus,
    byType,
  });
});

export const followUpCalendar = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const today = todayStr();

  const from = req.query.from ?? `${today.slice(0, 8)}01`;
  const to = req.query.to ?? today;

  const clauses = ['f.follow_up_date >= ?', 'f.follow_up_date <= ?'];
  const params = [from, to];
  if (req.query.assignedTo) {
    clauses.push('f.assigned_to = ?');
    params.push(req.query.assignedTo);
  }

  const { where, params: whereParams } = scopedFollowUpWhere(scope, clauses, params, 'f');
  const rows = db
    .prepare(`${FOLLOW_UP_SELECT} ${where} ORDER BY f.follow_up_date ASC, f.follow_up_time ASC, f.id ASC LIMIT 1000`)
    .all(...whereParams);

  return ok(res, rows.map((r) => followUpToJson(r, today)));
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createFollowUp = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const b = req.body;

  const target = resolveTarget(db, req, scope, { targetType: b.targetType, targetId: b.targetId });
  const companyId = target.companyId;

  const { assignedToVal, teamIdVal } = resolveAssignment(
    db, req, scope, companyId,
    b.assignedTo ?? (req.user.isSuperAdmin ? null : req.user.id)
  );

  const contactPerson = b.contactPerson ?? target.contactPerson ?? null;

  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO follow_ups (company_id, target_type, lead_id, customer_id, contact_person, activity_type,
                                 follow_up_date, follow_up_time, priority, status, assigned_to, team_id,
                                 notes, next_action, next_follow_up_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyId,
        target.targetType,
        target.targetType === 'lead' ? target.targetId : null,
        target.targetType === 'customer' ? target.targetId : null,
        contactPerson,
        b.activityType,
        b.followUpDate,
        b.followUpTime ?? null,
        b.priority ?? 'Medium',
        assignedToVal,
        teamIdVal,
        b.notes ?? null,
        b.nextAction ?? null,
        b.nextFollowUpDate ?? null,
        req.user.id
      );
    const followUpId = Number(info.lastInsertRowid);

    insertTimelineActivity(db, {
      targetType: target.targetType,
      targetId: target.targetId,
      userId: req.user.id,
      type: b.activityType,
      description: `${activityLabel(b.activityType)} scheduled${b.notes ? `: ${b.notes}` : ''}`,
      metadata: { followUpId, followUpDate: b.followUpDate, followUpTime: b.followUpTime ?? null, priority: b.priority ?? 'Medium' },
    });

    db.exec('COMMIT');

    notifyAssignee(db, req, followUpId, assignedToVal, companyId);
    req.audit?.('followup.create', { entityType: 'followup', entityId: followUpId, metadata: { targetType: target.targetType, targetId: target.targetId } });

    const row = db.prepare(`${FOLLOW_UP_SELECT} WHERE f.id = ?`).get(followUpId);
    return created(res, followUpToJson(row));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

export const updateFollowUp = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Follow-up not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessFollowUp(scope, row)) throw forbidden('You cannot modify this follow-up');

  const b = req.body;
  const FIELDS = {
    contactPerson: 'contact_person',
    activityType: 'activity_type',
    followUpDate: 'follow_up_date',
    followUpTime: 'follow_up_time',
    priority: 'priority',
    notes: 'notes',
    nextAction: 'next_action',
    nextFollowUpDate: 'next_follow_up_date',
  };

  const sets = [];
  const values = [];
  const changed = [];
  for (const [input, column] of Object.entries(FIELDS)) {
    if (b[input] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(b[input]);
    changed.push(input);
  }

  let assignedToVal = row.assigned_to;
  if (b.assignedTo !== undefined) {
    const resolved = resolveAssignment(db, req, scope, row.company_id, b.assignedTo);
    assignedToVal = resolved.assignedToVal;
    sets.push('assigned_to = ?');
    values.push(assignedToVal);
    sets.push('team_id = ?');
    values.push(resolved.teamIdVal);
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE follow_ups SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  if (changed.length) {
    insertTimelineActivity(db, {
      targetType: row.target_type,
      targetId: row.lead_id ?? row.customer_id,
      userId: req.user.id,
      type: 'follow_up',
      description: `Follow-up updated (${changed.map((c) => ({ contactPerson: 'contact', followUpDate: 'date', followUpTime: 'time', activityType: 'type', priority: 'priority', notes: 'notes', nextAction: 'next action', nextFollowUpDate: 'next date' }[c] ?? c)).join(', ')})`,
      metadata: { followUpId: row.id },
    });
  }
  if (b.assignedTo !== undefined && assignedToVal !== row.assigned_to) {
    const name = assignedToVal ? db.prepare('SELECT name FROM users WHERE id = ?').get(assignedToVal)?.name : null;
    insertTimelineActivity(db, {
      targetType: row.target_type,
      targetId: row.lead_id ?? row.customer_id,
      userId: req.user.id,
      type: 'assigned',
      description: assignedToVal ? `Follow-up assigned to ${name}` : 'Follow-up unassigned',
      metadata: { followUpId: row.id, from: row.assigned_to, to: assignedToVal },
    });
  }

  req.audit?.('followup.update', { entityType: 'followup', entityId: row.id });

  const updated = db.prepare(`${FOLLOW_UP_SELECT} WHERE f.id = ?`).get(row.id);
  return ok(res, followUpToJson(updated));
});

export const completeFollowUp = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Follow-up not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessFollowUp(scope, row)) throw forbidden('You cannot modify this follow-up');

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE follow_ups SET status = 'Completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              completed_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(req.user.id, row.id);

    insertTimelineActivity(db, {
      targetType: row.target_type,
      targetId: row.lead_id ?? row.customer_id,
      userId: req.user.id,
      type: 'follow_up',
      description: req.body.notes ? `Follow-up completed: ${req.body.notes}` : 'Follow-up completed',
      metadata: { followUpId: row.id },
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  req.audit?.('followup.complete', { entityType: 'followup', entityId: row.id });

  const updated = db.prepare(`${FOLLOW_UP_SELECT} WHERE f.id = ?`).get(row.id);
  return ok(res, followUpToJson(updated));
});

export const rescheduleFollowUp = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Follow-up not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessFollowUp(scope, row)) throw forbidden('You cannot modify this follow-up');

  const b = req.body;
  const { assignedToVal, teamIdVal } = resolveAssignment(db, req, scope, row.company_id, b.assignedTo ?? row.assigned_to);

  const newDate = b.followUpDate;
  const newTime = b.followUpTime ?? row.follow_up_time;

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE follow_ups SET status = 'Rescheduled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(row.id);

    const info = db
      .prepare(
        `INSERT INTO follow_ups (company_id, target_type, lead_id, customer_id, contact_person, activity_type,
                                 follow_up_date, follow_up_time, priority, status, assigned_to, team_id,
                                 notes, next_action, next_follow_up_date, rescheduled_from, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.company_id,
        row.target_type,
        row.lead_id,
        row.customer_id,
        row.contact_person,
        row.activity_type,
        newDate,
        newTime,
        row.priority,
        assignedToVal,
        teamIdVal,
        row.notes,
        row.next_action,
        row.next_follow_up_date,
        row.id,
        req.user.id
      );
    const newId = Number(info.lastInsertRowid);

    insertTimelineActivity(db, {
      targetType: row.target_type,
      targetId: row.lead_id ?? row.customer_id,
      userId: req.user.id,
      type: 'follow_up',
      description: `Follow-up rescheduled to ${newDate}${newTime ? ` ${newTime}` : ''}`,
      metadata: { followUpId: newId, from: row.id },
    });

    db.exec('COMMIT');

    notifyAssignee(db, req, newId, assignedToVal, row.company_id);
    req.audit?.('followup.reschedule', { entityType: 'followup', entityId: row.id, metadata: { newId } });

    const createdRow = db.prepare(`${FOLLOW_UP_SELECT} WHERE f.id = ?`).get(newId);
    return ok(res, followUpToJson(createdRow));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

export const assignFollowUp = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Follow-up not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessFollowUp(scope, row)) throw forbidden('You cannot modify this follow-up');

  const { assignedToVal, teamIdVal } = resolveAssignment(db, req, scope, row.company_id, req.body.assignedTo);

  db.prepare(
    `UPDATE follow_ups SET assigned_to = ?, team_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(assignedToVal, teamIdVal, row.id);

  const name = assignedToVal ? db.prepare('SELECT name FROM users WHERE id = ?').get(assignedToVal)?.name : null;
  insertTimelineActivity(db, {
    targetType: row.target_type,
    targetId: row.lead_id ?? row.customer_id,
    userId: req.user.id,
    type: 'assigned',
    description: assignedToVal ? `Follow-up assigned to ${name}` : 'Follow-up unassigned',
    metadata: { followUpId: row.id, from: row.assigned_to, to: assignedToVal },
  });

  notifyAssignee(db, req, row.id, assignedToVal, row.company_id);
  req.audit?.('followup.assign', { entityType: 'followup', entityId: row.id, metadata: { to: assignedToVal } });

  const updated = db.prepare(`${FOLLOW_UP_SELECT} WHERE f.id = ?`).get(row.id);
  return ok(res, followUpToJson(updated));
});

export const cancelFollowUp = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Follow-up not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessFollowUp(scope, row)) throw forbidden('You cannot modify this follow-up');

  db.prepare(
    `UPDATE follow_ups SET status = 'Cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(row.id);

  insertTimelineActivity(db, {
    targetType: row.target_type,
    targetId: row.lead_id ?? row.customer_id,
    userId: req.user.id,
    type: 'follow_up',
    description: req.body.notes ? `Follow-up cancelled: ${req.body.notes}` : 'Follow-up cancelled',
    metadata: { followUpId: row.id },
  });

  req.audit?.('followup.cancel', { entityType: 'followup', entityId: row.id });

  const updated = db.prepare(`${FOLLOW_UP_SELECT} WHERE f.id = ?`).get(row.id);
  return ok(res, followUpToJson(updated));
});

export const deleteFollowUp = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Follow-up not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessFollowUp(scope, row)) throw forbidden('You cannot delete this follow-up');

  db.prepare(
    `UPDATE follow_ups SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(row.id);

  req.audit?.('followup.delete', { entityType: 'followup', entityId: row.id });

  return ok(res, { id: row.id, deleted: true });
});

export const runReminders = asyncHandler(async (_req, res) => {
  const created = runFollowUpReminders();
  return ok(res, { created });
});
