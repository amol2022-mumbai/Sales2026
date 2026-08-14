import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { hasPermission } from '../services/userService.js';
import {
  getUserDataScope,
  buildLeadScopeWhere,
  canAccessLead,
  canAssignLeadTo,
} from '../services/access.js';
import {
  LEAD_STATUSES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  buildHeaderMap,
  normalizeRow,
  leadDuplicateKeys,
  parseCsv,
  bufferToRows,
  base64ToBuffer,
  leadsToCsv,
  leadsToXlsx,
} from '../services/leadFiles.js';

const MAX_IMPORT_ROWS = 10000;

const LEAD_SELECT = `
  SELECT l.*, u.name AS assigned_name, u.email AS assigned_email,
         t.name AS team_name, c.name AS created_by_name
  FROM leads l
  LEFT JOIN users u ON u.id = l.assigned_to
  LEFT JOIN teams t ON t.id = l.team_id
  LEFT JOIN users c ON c.id = l.created_by
`;

const SORTABLE = {
  leadNo: 'l.lead_no',
  companyName: 'l.company_name',
  contactPerson: 'l.contact_person',
  leadValue: 'l.lead_value',
  priority: 'l.priority',
  status: 'l.status',
  createdAt: 'l.created_at',
  nextFollowUp: 'l.next_follow_up',
};

function leadToJson(l) {
  return {
    id: l.id,
    leadNo: l.lead_no,
    companyId: l.company_id,
    companyName: l.company_name,
    contactPerson: l.contact_person,
    mobile: l.mobile,
    whatsapp: l.whatsapp,
    email: l.email,
    address: l.address,
    city: l.city,
    state: l.state,
    source: l.source,
    productService: l.product_service,
    leadValue: l.lead_value,
    priority: l.priority,
    status: l.status,
    assignedTo: l.assigned_to,
    assignedName: l.assigned_name || null,
    assignedEmail: l.assigned_email || null,
    teamId: l.team_id,
    teamName: l.team_name || null,
    nextFollowUp: l.next_follow_up,
    notes: l.notes,
    remarks: l.remarks,
    createdBy: l.created_by,
    createdByName: l.created_by_name || null,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}

function insertActivity(db, { leadId, userId, type, description, metadata = null }) {
  const info = db
    .prepare(
      `INSERT INTO lead_activities (lead_id, user_id, type, description, metadata)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(leadId, userId, type, description, metadata ? JSON.stringify(metadata) : null);
  return Number(info.lastInsertRowid);
}

function activityToJson(a) {
  return {
    id: a.id,
    leadId: a.lead_id,
    userId: a.user_id,
    userName: a.user_name || null,
    type: a.type,
    description: a.description,
    metadata: a.metadata ? JSON.parse(a.metadata) : null,
    createdAt: a.created_at,
  };
}

/** Combine the data scope with the soft-delete filter and any extra clauses. */
function scopedLeadWhere(scope, extraClauses = [], extraParams = [], alias = 'l') {
  const { where, params } = buildLeadScopeWhere(scope, alias);
  const clauses = [...extraClauses, `${alias}.deleted_at IS NULL`];
  const whereSql = where ? `${where} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;
  return { where: whereSql, params: [...params, ...extraParams] };
}

function resolveTargetCompany(req) {
  if (req.user.isSuperAdmin) return req.body.companyId ?? null;
  return req.user.companyId;
}

/** Validate team / assignee choices for a create or update. */
function resolveAssignment(db, req, scope, companyId, { assignedTo, teamId }) {
  let teamIdVal = teamId ?? null;
  let assignedToVal = assignedTo ?? null;

  if (teamIdVal != null) {
    const team = db.prepare('SELECT id, company_id FROM teams WHERE id = ?').get(teamIdVal);
    if (!team || team.company_id !== companyId) throw badRequest('Invalid team');
    if (scope.type === 'teams' || scope.type === 'team') {
      if (!scope.teamIds.includes(teamIdVal)) throw forbidden('You can only assign leads to teams you manage');
    } else if (scope.type === 'self' && teamIdVal !== req.user.teamId) {
      throw forbidden('You can only assign leads to your own team');
    }
  }

  if (assignedToVal != null) {
    const target = db.prepare('SELECT id, company_id, team_id FROM users WHERE id = ?').get(assignedToVal);
    if (!target || target.company_id !== companyId) throw badRequest('Invalid assignee');
    if (assignedToVal !== req.user.id && !hasPermission(req.user, 'leads:assign')) {
      throw forbidden('You do not have permission to assign leads to others');
    }
    if (!canAssignLeadTo(scope, target)) {
      throw forbidden('You can only assign leads within your scope');
    }
  }

  return { teamIdVal, assignedToVal };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const listLeads = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize, search, status, priority, source, assignedTo, teamId, companyId, sort, order } = req.query;
  const scope = getUserDataScope(req.user);

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(l.lead_no LIKE ? OR l.company_name LIKE ? OR l.contact_person LIKE ? OR l.mobile LIKE ? OR l.email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (status) {
    clauses.push('l.status = ?');
    params.push(status);
  }
  if (priority) {
    clauses.push('l.priority = ?');
    params.push(priority);
  }
  if (source) {
    clauses.push('l.source = ?');
    params.push(source);
  }
  if (assignedTo) {
    clauses.push('l.assigned_to = ?');
    params.push(assignedTo);
  }
  if (teamId) {
    clauses.push('l.team_id = ?');
    params.push(teamId);
  }
  if (companyId && req.user.isSuperAdmin) {
    clauses.push('l.company_id = ?');
    params.push(companyId);
  }

  const { where, params: whereParams } = scopedLeadWhere(scope, clauses, params, 'l');

  const sortColumn = SORTABLE[sort] || 'l.created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM leads l ${where}`).get(...whereParams).c;
  const rows = db
    .prepare(`${LEAD_SELECT} ${where} ORDER BY ${sortColumn} ${sortOrder}, l.id DESC LIMIT ? OFFSET ?`)
    .all(...whereParams, pageSize, (page - 1) * pageSize);

  return paginated(res, rows.map(leadToJson), { page, pageSize, total });
});

export const getLead = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare(`${LEAD_SELECT} WHERE l.id = ?`).get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Lead not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessLead(scope, row)) throw forbidden('You cannot access this lead');

  const activities = db
    .prepare(
      `SELECT a.*, u.name AS user_name
       FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.lead_id = ? ORDER BY a.created_at DESC, a.id DESC`
    )
    .all(row.id);

  const lead = leadToJson(row);
  lead.activities = activities.map(activityToJson);
  lead.followUpHistory = activities
    .filter((a) => a.type === 'follow_up' || a.type === 'created')
    .map(activityToJson);

  return ok(res, lead);
});

export const leadMeta = asyncHandler(async (_req, res) => {
  return ok(res, { statuses: LEAD_STATUSES, priorities: LEAD_PRIORITIES, sources: LEAD_SOURCES });
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createLead = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const companyId = resolveTargetCompany(req);
  if (!companyId) throw badRequest('A company is required to create a lead');

  const { teamIdVal, assignedToVal } = resolveAssignment(db, req, scope, companyId, {
    assignedTo: req.body.assignedTo ?? (req.user.isSuperAdmin ? null : req.user.id),
    teamId: req.body.teamId ?? req.user.teamId ?? null,
  });

  const b = req.body;
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO leads (company_id, company_name, contact_person, mobile, whatsapp, email, address, city, state,
                            source, product_service, lead_value, priority, status, assigned_to, team_id,
                            next_follow_up, notes, remarks, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyId,
        b.companyName,
        b.contactPerson ?? null,
        b.mobile ?? null,
        b.whatsapp ?? null,
        b.email ?? null,
        b.address ?? null,
        b.city ?? null,
        b.state ?? null,
        b.source ?? null,
        b.productService ?? null,
        b.leadValue ?? null,
        b.priority ?? 'Medium',
        b.status ?? 'New',
        assignedToVal,
        teamIdVal,
        b.nextFollowUp ?? null,
        b.notes ?? null,
        b.remarks ?? null,
        req.user.id
      );
    const leadId = Number(info.lastInsertRowid);
    const leadNo = `LEAD-${String(leadId).padStart(6, '0')}`;
    db.prepare('UPDATE leads SET lead_no = ? WHERE id = ?').run(leadNo, leadId);
    insertActivity(db, { leadId, userId: req.user.id, type: 'created', description: 'Lead created' });
    db.exec('COMMIT');

    req.audit?.('lead.create', { entityType: 'lead', entityId: leadId, metadata: { companyName: b.companyName } });

    const row = db.prepare(`${LEAD_SELECT} WHERE l.id = ?`).get(leadId);
    return created(res, leadToJson(row));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

const UPDATABLE_FIELDS = {
  companyName: 'company_name',
  contactPerson: 'contact_person',
  mobile: 'mobile',
  whatsapp: 'whatsapp',
  email: 'email',
  address: 'address',
  city: 'city',
  state: 'state',
  source: 'source',
  productService: 'product_service',
  leadValue: 'lead_value',
  priority: 'priority',
  status: 'status',
  nextFollowUp: 'next_follow_up',
  notes: 'notes',
  remarks: 'remarks',
};

export const updateLead = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Lead not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessLead(scope, row)) throw forbidden('You cannot modify this lead');

  const b = req.body;
  const sets = [];
  const values = [];
  const changed = [];

  for (const [input, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (b[input] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(b[input]);
    if (input !== 'notes' && input !== 'remarks') changed.push(input);
  }

  let assignedToVal = row.assigned_to;
  if (b.assignedTo !== undefined) {
    const resolved = resolveAssignment(db, req, scope, row.company_id, { assignedTo: b.assignedTo, teamId: undefined });
    assignedToVal = resolved.assignedToVal;
    sets.push('assigned_to = ?');
    values.push(assignedToVal);
  }

  let teamIdVal = row.team_id;
  if (b.teamId !== undefined) {
    const resolved = resolveAssignment(db, req, scope, row.company_id, { assignedTo: undefined, teamId: b.teamId });
    teamIdVal = resolved.teamIdVal;
    sets.push('team_id = ?');
    values.push(teamIdVal);
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // Activity timeline for meaningful changes.
  if (b.status !== undefined && b.status !== row.status) {
    insertActivity(db, {
      leadId: row.id,
      userId: req.user.id,
      type: 'status',
      description: `Status changed from ${row.status} to ${b.status}`,
      metadata: { from: row.status, to: b.status },
    });
  }
  if (b.assignedTo !== undefined && assignedToVal !== row.assigned_to) {
    const name = assignedToVal ? db.prepare('SELECT name FROM users WHERE id = ?').get(assignedToVal)?.name : null;
    insertActivity(db, {
      leadId: row.id,
      userId: req.user.id,
      type: 'assigned',
      description: assignedToVal ? `Assigned to ${name}` : 'Unassigned',
      metadata: { from: row.assigned_to, to: assignedToVal },
    });
  }
  if (b.nextFollowUp !== undefined && b.nextFollowUp !== row.next_follow_up) {
    insertActivity(db, {
      leadId: row.id,
      userId: req.user.id,
      type: 'follow_up',
      description: b.nextFollowUp ? `Follow-up scheduled for ${b.nextFollowUp}` : 'Follow-up cleared',
      metadata: { date: b.nextFollowUp },
    });
  }
  if (changed.length) {
    insertActivity(db, {
      leadId: row.id,
      userId: req.user.id,
      type: 'updated',
      description: `Updated ${changed.join(', ')}`,
      metadata: { fields: changed },
    });
  }

  req.audit?.('lead.update', { entityType: 'lead', entityId: row.id });

  const updated = db.prepare(`${LEAD_SELECT} WHERE l.id = ?`).get(row.id);
  return ok(res, leadToJson(updated));
});

export const deleteLead = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Lead not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessLead(scope, row)) throw forbidden('You cannot delete this lead');

  db.prepare("UPDATE leads SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  insertActivity(db, { leadId: row.id, userId: req.user.id, type: 'deleted', description: 'Lead deleted' });

  req.audit?.('lead.delete', { entityType: 'lead', entityId: row.id, metadata: { leadNo: row.lead_no } });

  return ok(res, { id: row.id, deleted: true });
});

export const addNote = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Lead not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessLead(scope, row)) throw forbidden('You cannot modify this lead');

  const activityId = insertActivity(db, { leadId: row.id, userId: req.user.id, type: 'note', description: req.body.note });
  req.audit?.('lead.note', { entityType: 'lead', entityId: row.id });

  const activity = db
    .prepare(`SELECT a.*, u.name AS user_name FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?`)
    .get(activityId);

  return ok(res, activityToJson(activity));
});

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export const bulkAssign = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { leadIds, assignedTo } = req.body;

  let assignedToVal = assignedTo ?? null;
  if (assignedToVal != null) {
    const target = db.prepare('SELECT id, company_id, team_id FROM users WHERE id = ?').get(assignedToVal);
    if (!target) throw badRequest('Invalid assignee');
    if (!canAssignLeadTo(scope, target)) throw forbidden('You can only assign leads within your scope');
  }

  const placeholders = leadIds.map(() => '?').join(', ');
  const targets = db.prepare(`SELECT * FROM leads WHERE id IN (${placeholders}) AND deleted_at IS NULL`).all(...leadIds);

  let updated = 0;
  let skipped = 0;
  for (const lead of targets) {
    if (!canAccessLead(scope, lead)) {
      skipped += 1;
      continue;
    }
    db.prepare("UPDATE leads SET assigned_to = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(assignedToVal, lead.id);
    const name = assignedToVal ? db.prepare('SELECT name FROM users WHERE id = ?').get(assignedToVal)?.name : null;
    insertActivity(db, {
      leadId: lead.id,
      userId: req.user.id,
      type: 'assigned',
      description: assignedToVal ? `Assigned to ${name}` : 'Unassigned',
      metadata: { from: lead.assigned_to, to: assignedToVal },
    });
    updated += 1;
  }

  req.audit?.('lead.bulk_assign', { entityType: 'lead', metadata: { count: updated, assignedTo: assignedToVal } });

  return ok(res, { updated, skipped });
});

export const bulkStatus = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { leadIds, status } = req.body;

  const placeholders = leadIds.map(() => '?').join(', ');
  const targets = db.prepare(`SELECT * FROM leads WHERE id IN (${placeholders}) AND deleted_at IS NULL`).all(...leadIds);

  let updated = 0;
  let skipped = 0;
  for (const lead of targets) {
    if (!canAccessLead(scope, lead)) {
      skipped += 1;
      continue;
    }
    db.prepare("UPDATE leads SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, lead.id);
    insertActivity(db, {
      leadId: lead.id,
      userId: req.user.id,
      type: 'status',
      description: `Status changed from ${lead.status} to ${status}`,
      metadata: { from: lead.status, to: status },
    });
    updated += 1;
  }

  req.audit?.('lead.bulk_status', { entityType: 'lead', metadata: { count: updated, status } });

  return ok(res, { updated, skipped });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const leadDashboard = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { where, params } = scopedLeadWhere(scope, [], []);

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) AS new_count,
         SUM(CASE WHEN status = 'Qualified' THEN 1 ELSE 0 END) AS qualified,
         SUM(CASE WHEN status = 'Won' THEN 1 ELSE 0 END) AS won,
         SUM(CASE WHEN status = 'Lost' THEN 1 ELSE 0 END) AS lost,
         SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned,
         SUM(CASE WHEN next_follow_up IS NOT NULL AND date(next_follow_up) < date('now')
                   AND status NOT IN ('Won','Lost','Not Interested') THEN 1 ELSE 0 END) AS overdue
       FROM leads l ${where}`
    )
    .get(...params);

  const won = stats.won || 0;
  const lost = stats.lost || 0;
  const conversionRate = won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : 0;

  const byStatus = LEAD_STATUSES.map((status) => {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM leads l ${where} AND l.status = ?`)
      .get(...params, status);
    return { status, count: row.c };
  });

  return ok(res, {
    total: stats.total,
    newLeads: stats.new_count || 0,
    qualified: stats.qualified || 0,
    won,
    lost,
    conversionRate,
    unassigned: stats.unassigned || 0,
    overdue: stats.overdue || 0,
    byStatus,
  });
});

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

export const importLeads = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const companyId = req.user.isSuperAdmin ? req.body.companyId ?? null : req.user.companyId;
  if (!companyId) throw badRequest('A target company is required to import leads');

  const { format, data } = req.body;
  let rows;
  try {
    const buffer = format === 'xlsx' ? base64ToBuffer(data) : Buffer.from(String(data), 'utf8');
    rows = bufferToRows(buffer, { format: format === 'xlsx' ? 'xlsx' : 'csv' });
  } catch {
    throw badRequest('Unable to parse the uploaded file');
  }

  if (!rows.length || rows.length < 2) throw badRequest('The file must contain a header row and at least one data row');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw badRequest(`Import exceeds the maximum of ${MAX_IMPORT_ROWS} data rows`);

  const { map } = buildHeaderMap(rows[0]);
  if (map.companyName === undefined) {
    throw badRequest('The file must contain a "Company" (or equivalent) column');
  }

  // Existing duplicate keys for this company.
  const existingKeys = new Set();
  const existing = db
    .prepare('SELECT company_name, email, mobile FROM leads WHERE company_id = ? AND deleted_at IS NULL')
    .all(companyId);
  for (const e of existing) {
    const normalized = { companyName: e.company_name, email: e.email, mobile: e.mobile };
    for (const k of leadDuplicateKeys(normalized)) existingKeys.add(k);
  }

  const seenKeys = new Set();
  const report = { total: rows.length - 1, imported: 0, duplicates: [], errors: [] };

  const emailToUser = db.prepare('SELECT id, company_id, team_id FROM users WHERE company_id = ? AND email = ?');

  db.exec('BEGIN');
  try {
    for (let i = 1; i < rows.length; i += 1) {
      const rowNumber = i + 1;
      const { row, errors } = normalizeRow(map, rows[i]);
      if (errors.length) {
        report.errors.push({ row: rowNumber, message: errors.join('; ') });
        continue;
      }

      const keys = leadDuplicateKeys(row);
      if (keys.some((k) => existingKeys.has(k) || seenKeys.has(k))) {
        report.duplicates.push({ row: rowNumber, message: 'Duplicate lead (company + email/mobile already exists)' });
        continue;
      }
      keys.forEach((k) => seenKeys.add(k));

      // Resolve assignee from email, defaulting to the importer.
      let assignedToVal = req.user.isSuperAdmin ? null : req.user.id;
      if (row.assignedTo) {
        const user = emailToUser.get(companyId, String(row.assignedTo).toLowerCase().trim());
        if (!user) {
          report.errors.push({ row: rowNumber, message: `Assigned user not found: ${row.assignedTo}` });
          continue;
        }
        if (!canAssignLeadTo(scope, user)) {
          report.errors.push({ row: rowNumber, message: `You cannot assign leads to ${row.assignedTo}` });
          continue;
        }
        assignedToVal = user.id;
      }

      const info = db
        .prepare(
          `INSERT INTO leads (company_id, company_name, contact_person, mobile, whatsapp, email, address, city, state,
                              source, product_service, lead_value, priority, status, assigned_to, next_follow_up, notes, remarks, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          companyId,
          row.companyName,
          row.contactPerson ?? null,
          row.mobile ?? null,
          row.whatsapp ?? null,
          row.email ?? null,
          row.address ?? null,
          row.city ?? null,
          row.state ?? null,
          row.source ?? null,
          row.productService ?? null,
          row.leadValue ?? null,
          row.priority ?? 'Medium',
          row.status ?? 'New',
          assignedToVal,
          row.nextFollowUp ?? null,
          row.notes ?? null,
          row.remarks ?? null,
          req.user.id
        );
      const leadId = Number(info.lastInsertRowid);
      db.prepare('UPDATE leads SET lead_no = ? WHERE id = ?').run(`LEAD-${String(leadId).padStart(6, '0')}`, leadId);
      insertActivity(db, { leadId, userId: req.user.id, type: 'created', description: 'Lead imported' });
      report.imported += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  req.audit?.('lead.import', { entityType: 'lead', metadata: { companyId, imported: report.imported } });

  return ok(res, report);
});

export const exportLeads = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { search, status, priority, source, assignedTo, teamId, format } = req.query;

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(l.lead_no LIKE ? OR l.company_name LIKE ? OR l.contact_person LIKE ? OR l.mobile LIKE ? OR l.email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (status) {
    clauses.push('l.status = ?');
    params.push(status);
  }
  if (priority) {
    clauses.push('l.priority = ?');
    params.push(priority);
  }
  if (source) {
    clauses.push('l.source = ?');
    params.push(source);
  }
  if (assignedTo) {
    clauses.push('l.assigned_to = ?');
    params.push(assignedTo);
  }
  if (teamId) {
    clauses.push('l.team_id = ?');
    params.push(teamId);
  }

  const { where, params: whereParams } = scopedLeadWhere(scope, clauses, params, 'l');
  const rows = db.prepare(`${LEAD_SELECT} ${where} ORDER BY l.id DESC LIMIT 100000`).all(...whereParams);
  const leads = rows.map((r) => {
    const l = leadToJson(r);
    return {
      ...l,
      createdAt: l.createdAt?.slice(0, 10),
    };
  });

  req.audit?.('lead.export', { entityType: 'lead', metadata: { count: leads.length } });

  if (format === 'xlsx') {
    const buffer = leadsToXlsx(leads);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.xlsx"');
    return res.send(buffer);
  }

  const csv = leadsToCsv(leads);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  return res.send(csv);
});
