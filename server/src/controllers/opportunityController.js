import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { hasPermission } from '../services/userService.js';
import {
  getUserDataScope,
  buildOpportunityScopeWhere,
  canAccessOpportunity,
  canAssignOpportunityTo,
  canAccessLead,
  canAccessCustomer,
} from '../services/access.js';
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_OPEN_STAGES,
  OPPORTUNITY_PRIORITIES,
  insertOpportunityActivity,
} from '../services/opportunityService.js';

const OPPORTUNITY_SELECT = `
  SELECT o.*, u.name AS assigned_name, cr.name AS created_by_name,
         t.name AS team_name, tl.company_name AS lead_name, tc.name AS customer_name
  FROM opportunities o
  LEFT JOIN users u ON u.id = o.assigned_to
  LEFT JOIN users cr ON cr.id = o.created_by
  LEFT JOIN teams t ON t.id = o.team_id
  LEFT JOIN leads tl ON tl.id = o.lead_id
  LEFT JOIN customers tc ON tc.id = o.customer_id
`;

const SORTABLE = {
  opportunityNo: 'o.opportunity_no',
  dealValue: 'o.deal_value',
  probability: 'o.probability',
  stage: 'o.stage',
  priority: 'o.priority',
  expectedCloseDate: 'o.expected_close_date',
  contactPerson: 'o.contact_person',
  createdAt: 'o.created_at',
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function opportunityToJson(o) {
  const weighted = o.deal_value != null ? Math.round(o.deal_value * (o.probability || 0)) / 100 : null;
  return {
    id: o.id,
    opportunityNo: o.opportunity_no,
    companyId: o.company_id,
    targetType: o.target_type,
    leadId: o.lead_id,
    customerId: o.customer_id,
    targetId: o.lead_id ?? o.customer_id,
    targetName: o.lead_name ?? o.customer_name ?? null,
    contactPerson: o.contact_person,
    productService: o.product_service,
    dealValue: o.deal_value,
    probability: o.probability,
    weightedValue: weighted,
    expectedCloseDate: o.expected_close_date,
    assignedTo: o.assigned_to,
    assignedName: o.assigned_name || null,
    teamId: o.team_id,
    teamName: o.team_name || null,
    stage: o.stage,
    priority: o.priority,
    notes: o.notes,
    nextAction: o.next_action,
    createdBy: o.created_by,
    createdByName: o.created_by_name || null,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

function activityToJson(a) {
  return {
    id: a.id,
    opportunityId: a.opportunity_id,
    userId: a.user_id,
    userName: a.user_name || null,
    type: a.type,
    description: a.description,
    metadata: a.metadata ? JSON.parse(a.metadata) : null,
    createdAt: a.created_at,
  };
}

function scopedOpportunityWhere(scope, extraClauses = [], extraParams = [], alias = 'o') {
  const { where, params } = buildOpportunityScopeWhere(scope, alias);
  const clauses = [...extraClauses, `${alias}.deleted_at IS NULL`];
  const whereSql = where ? `${where} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;
  return { where: whereSql, params: [...params, ...extraParams] };
}

function resolveTargetCompany(req) {
  if (req.user.isSuperAdmin) return req.body.companyId ?? null;
  return req.user.companyId;
}

/** Load + authorize the target entity, returning { targetType, targetId, companyId, contactPerson }. */
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

function resolveOpportunityAssignment(db, req, scope, companyId, { assignedTo, teamId }) {
  let assignedToVal = assignedTo ?? null;
  let teamIdVal = teamId ?? null;

  if (assignedToVal != null) {
    const target = db.prepare('SELECT id, company_id, team_id FROM users WHERE id = ?').get(assignedToVal);
    if (!target || target.company_id !== companyId) throw badRequest('Invalid assignee');
    if (assignedToVal !== req.user.id && !hasPermission(req.user, 'pipeline:assign')) {
      throw forbidden('You do not have permission to assign opportunities to others');
    }
    if (!canAssignOpportunityTo(scope, target)) {
      throw forbidden('You can only assign opportunities within your scope');
    }
    if (teamIdVal == null) teamIdVal = target.team_id ?? null;
  }

  if (teamIdVal != null) {
    const team = db.prepare('SELECT id, company_id FROM teams WHERE id = ?').get(teamIdVal);
    if (!team || team.company_id !== companyId) throw badRequest('Invalid team');
    if (scope.type === 'teams' || scope.type === 'team') {
      if (!scope.teamIds.includes(teamIdVal)) throw forbidden('You can only assign opportunities to teams you manage');
    } else if (scope.type === 'self' && teamIdVal !== req.user.teamId) {
      throw forbidden('You can only assign opportunities to your own team');
    }
  }

  return { assignedToVal, teamIdVal };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const listOpportunities = asyncHandler(async (req, res) => {
  const db = getDb();
  const {
    page, pageSize, search, stage, priority, assignedTo, teamId,
    targetType, targetId, companyId, dateFrom, dateTo, sort, order,
  } = req.query;
  const scope = getUserDataScope(req.user);

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(o.opportunity_no LIKE ? OR o.contact_person LIKE ? OR o.product_service LIKE ? OR o.notes LIKE ? OR o.next_action LIKE ? OR tl.company_name LIKE ? OR tc.name LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (stage) {
    clauses.push('o.stage = ?');
    params.push(stage);
  }
  if (priority) {
    clauses.push('o.priority = ?');
    params.push(priority);
  }
  if (assignedTo) {
    clauses.push('o.assigned_to = ?');
    params.push(assignedTo);
  }
  if (teamId) {
    clauses.push('o.team_id = ?');
    params.push(teamId);
  }
  if (companyId && req.user.isSuperAdmin) {
    clauses.push('o.company_id = ?');
    params.push(companyId);
  }
  if (targetType && targetId) {
    clauses.push(targetType === 'lead' ? 'o.lead_id = ?' : 'o.customer_id = ?');
    params.push(targetId);
  } else if (targetType) {
    clauses.push('o.target_type = ?');
    params.push(targetType);
  }
  if (dateFrom) {
    clauses.push('o.expected_close_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('o.expected_close_date <= ?');
    params.push(dateTo);
  }

  const { where, params: whereParams } = scopedOpportunityWhere(scope, clauses, params, 'o');

  const sortColumn = SORTABLE[sort] || 'o.created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM opportunities o
       LEFT JOIN leads tl ON tl.id = o.lead_id
       LEFT JOIN customers tc ON tc.id = o.customer_id ${where}`
    )
    .get(...whereParams).c;
  const rows = db
    .prepare(`${OPPORTUNITY_SELECT} ${where} ORDER BY ${sortColumn} ${sortOrder}, o.id DESC LIMIT ? OFFSET ?`)
    .all(...whereParams, pageSize, (page - 1) * pageSize);

  return paginated(res, rows.map(opportunityToJson), { page, pageSize, total });
});

export const getOpportunity = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare(`${OPPORTUNITY_SELECT} WHERE o.id = ?`).get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Opportunity not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessOpportunity(scope, row)) throw forbidden('You cannot access this opportunity');

  const activities = db
    .prepare(
      `SELECT a.*, u.name AS user_name
       FROM opportunity_activities a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.opportunity_id = ? ORDER BY a.created_at DESC, a.id DESC`
    )
    .all(row.id)
    .map(activityToJson);

  // Related follow-ups for the opportunity's target entity.
  const followUps = db
    .prepare(
      `SELECT f.id, f.activity_type, f.follow_up_date, f.follow_up_time, f.status, f.assigned_to,
              u.name AS assigned_name
       FROM follow_ups f LEFT JOIN users u ON u.id = f.assigned_to
       WHERE f.target_type = ? AND (f.lead_id = ? OR f.customer_id = ?) AND f.deleted_at IS NULL
       ORDER BY f.follow_up_date DESC, f.follow_up_time DESC`
    )
    .all(row.target_type, row.lead_id, row.customer_id)
    .map((f) => ({
      id: f.id,
      activityType: f.activity_type,
      followUpDate: f.follow_up_date,
      followUpTime: f.follow_up_time,
      status: f.status,
      assignedName: f.assigned_name || null,
    }));

  const opportunity = opportunityToJson(row);
  opportunity.activities = activities;
  opportunity.followUps = followUps;

  return ok(res, opportunity);
});

export const opportunityMeta = asyncHandler(async (_req, res) => {
  return ok(res, { stages: OPPORTUNITY_STAGES, priorities: OPPORTUNITY_PRIORITIES });
});

export const opportunityBoard = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { search, assignedTo, teamId, priority, targetType, companyId } = req.query;

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(o.opportunity_no LIKE ? OR o.contact_person LIKE ? OR o.product_service LIKE ? OR tl.company_name LIKE ? OR tc.name LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (assignedTo) {
    clauses.push('o.assigned_to = ?');
    params.push(assignedTo);
  }
  if (teamId) {
    clauses.push('o.team_id = ?');
    params.push(teamId);
  }
  if (priority) {
    clauses.push('o.priority = ?');
    params.push(priority);
  }
  if (targetType) {
    clauses.push('o.target_type = ?');
    params.push(targetType);
  }
  if (companyId && req.user.isSuperAdmin) {
    clauses.push('o.company_id = ?');
    params.push(companyId);
  }

  const { where, params: whereParams } = scopedOpportunityWhere(scope, clauses, params, 'o');
  const rows = db
    .prepare(`${OPPORTUNITY_SELECT} ${where} ORDER BY o.priority DESC, o.expected_close_date ASC, o.id DESC LIMIT 2000`)
    .all(...whereParams);

  const byStage = {};
  for (const r of rows) {
    const o = opportunityToJson(r);
    if (!byStage[o.stage]) byStage[o.stage] = [];
    byStage[o.stage].push(o);
  }

  const columns = OPPORTUNITY_STAGES.map((stage) => {
    const items = byStage[stage] || [];
    const value = items.reduce((sum, i) => sum + (i.dealValue || 0), 0);
    const weighted = items.reduce((sum, i) => sum + (i.weightedValue || 0), 0);
    return { stage, count: items.length, value: Math.round(value * 100) / 100, weightedValue: Math.round(weighted * 100) / 100, items };
  });

  return ok(res, { stages: OPPORTUNITY_STAGES, columns });
});

export const opportunityDashboard = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const today = todayStr();
  const { where, params } = scopedOpportunityWhere(scope, [], []);

  const openStages = OPPORTUNITY_OPEN_STAGES.map(() => '?').join(', ');
  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN stage NOT IN ('Won','Lost') THEN deal_value ELSE 0 END) AS pipeline_value,
         SUM(CASE WHEN stage NOT IN ('Won','Lost') THEN deal_value * probability / 100.0 ELSE 0 END) AS weighted_value,
         SUM(CASE WHEN stage = 'Won' THEN deal_value ELSE 0 END) AS won_value,
         SUM(CASE WHEN stage = 'Lost' THEN deal_value ELSE 0 END) AS lost_value,
         SUM(CASE WHEN stage NOT IN ('Won','Lost') AND expected_close_date >= ? THEN deal_value ELSE 0 END) AS expected_close_value
       FROM opportunities o ${where}`
    )
    .get(today, ...params);

  const won = stats.won_value || 0;
  const lost = stats.lost_value || 0;
  const wonCount = db.prepare(`SELECT COUNT(*) AS c FROM opportunities o ${where} AND o.stage = 'Won'`).get(...params).c;
  const lostCount = db.prepare(`SELECT COUNT(*) AS c FROM opportunities o ${where} AND o.stage = 'Lost'`).get(...params).c;
  const closedCount = wonCount + lostCount;
  const conversionRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 1000) / 10 : 0;

  const byStage = OPPORTUNITY_STAGES.map((stage) => {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS c, SUM(deal_value) AS value, SUM(deal_value * probability / 100.0) AS weighted
         FROM opportunities o ${where} AND o.stage = ?`
      )
      .get(...params, stage);
    return {
      stage,
      count: r.c || 0,
      value: Math.round((r.value || 0) * 100) / 100,
      weightedValue: Math.round((r.weighted || 0) * 100) / 100,
    };
  });

  return ok(res, {
    total: stats.total || 0,
    pipelineValue: Math.round((stats.pipeline_value || 0) * 100) / 100,
    weightedValue: Math.round((stats.weighted_value || 0) * 100) / 100,
    wonValue: Math.round(won * 100) / 100,
    lostValue: Math.round(lost * 100) / 100,
    expectedCloseValue: Math.round((stats.expected_close_value || 0) * 100) / 100,
    conversionRate,
    byStage,
  });
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createOpportunity = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const b = req.body;

  const target = resolveTarget(db, req, scope, { targetType: b.targetType, targetId: b.targetId });
  const companyId = target.companyId;

  const { assignedToVal, teamIdVal } = resolveOpportunityAssignment(db, req, scope, companyId, {
    assignedTo: b.assignedTo ?? (req.user.isSuperAdmin ? null : req.user.id),
    teamId: b.teamId ?? req.user.teamId ?? null,
  });

  const contactPerson = b.contactPerson ?? target.contactPerson ?? null;

  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO opportunities (company_id, target_type, lead_id, customer_id, contact_person, product_service,
                                    deal_value, probability, expected_close_date, assigned_to, team_id,
                                    stage, priority, notes, next_action, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyId,
        target.targetType,
        target.targetType === 'lead' ? target.targetId : null,
        target.targetType === 'customer' ? target.targetId : null,
        contactPerson,
        b.productService ?? null,
        b.dealValue ?? null,
        b.probability ?? 0,
        b.expectedCloseDate ?? null,
        assignedToVal,
        teamIdVal,
        b.stage ?? 'New',
        b.priority ?? 'Medium',
        b.notes ?? null,
        b.nextAction ?? null,
        req.user.id
      );
    const opportunityId = Number(info.lastInsertRowid);
    const opportunityNo = `OPP-${String(opportunityId).padStart(6, '0')}`;
    db.prepare('UPDATE opportunities SET opportunity_no = ? WHERE id = ?').run(opportunityNo, opportunityId);

    insertOpportunityActivity(db, {
      opportunityId,
      targetType: target.targetType,
      targetId: target.targetId,
      userId: req.user.id,
      type: 'created',
      description: 'Opportunity created',
      metadata: { stage: b.stage ?? 'New', dealValue: b.dealValue ?? null, probability: b.probability ?? 0 },
    });

    db.exec('COMMIT');

    req.audit?.('pipeline.create', { entityType: 'opportunity', entityId: opportunityId, metadata: { targetType: target.targetType, targetId: target.targetId } });

    const row = db.prepare(`${OPPORTUNITY_SELECT} WHERE o.id = ?`).get(opportunityId);
    return created(res, opportunityToJson(row));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

const UPDATABLE_FIELDS = {
  contactPerson: 'contact_person',
  productService: 'product_service',
  dealValue: 'deal_value',
  probability: 'probability',
  expectedCloseDate: 'expected_close_date',
  priority: 'priority',
  notes: 'notes',
  nextAction: 'next_action',
};

export const updateOpportunity = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Opportunity not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessOpportunity(scope, row)) throw forbidden('You cannot modify this opportunity');

  const b = req.body;
  const sets = [];
  const values = [];
  const changed = [];

  for (const [input, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (b[input] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(b[input]);
    changed.push(input);
  }

  let assignedToVal = row.assigned_to;
  if (b.assignedTo !== undefined) {
    const resolved = resolveOpportunityAssignment(db, req, scope, row.company_id, { assignedTo: b.assignedTo, teamId: undefined });
    assignedToVal = resolved.assignedToVal;
    sets.push('assigned_to = ?');
    values.push(assignedToVal);
    sets.push('team_id = ?');
    values.push(resolved.teamIdVal);
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  const targetId = row.lead_id ?? row.customer_id;

  if (changed.length) {
    insertOpportunityActivity(db, {
      opportunityId: row.id,
      targetType: row.target_type,
      targetId,
      userId: req.user.id,
      type: 'updated',
      description: `Updated ${changed.map((c) => ({ contactPerson: 'contact', productService: 'product/service', dealValue: 'deal value', probability: 'probability', expectedCloseDate: 'expected close date', priority: 'priority', notes: 'notes', nextAction: 'next action' }[c] ?? c)).join(', ')}`,
      metadata: { fields: changed },
    });
  }

  // Audit value changes (deal value / probability) explicitly.
  const valueChanged = (b.dealValue !== undefined && b.dealValue !== row.deal_value) ||
    (b.probability !== undefined && b.probability !== row.probability);
  if (valueChanged) {
    req.audit?.('pipeline.value_change', {
      entityType: 'opportunity',
      entityId: row.id,
      metadata: { from: { dealValue: row.deal_value, probability: row.probability }, to: { dealValue: b.dealValue ?? row.deal_value, probability: b.probability ?? row.probability } },
    });
  }

  if (b.assignedTo !== undefined && assignedToVal !== row.assigned_to) {
    const name = assignedToVal ? db.prepare('SELECT name FROM users WHERE id = ?').get(assignedToVal)?.name : null;
    insertOpportunityActivity(db, {
      opportunityId: row.id,
      targetType: row.target_type,
      targetId,
      userId: req.user.id,
      type: 'assigned',
      description: assignedToVal ? `Assigned to ${name}` : 'Unassigned',
      metadata: { from: row.assigned_to, to: assignedToVal },
    });
  }

  req.audit?.('pipeline.update', { entityType: 'opportunity', entityId: row.id });

  const updated = db.prepare(`${OPPORTUNITY_SELECT} WHERE o.id = ?`).get(row.id);
  return ok(res, opportunityToJson(updated));
});

export const moveStage = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Opportunity not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessOpportunity(scope, row)) throw forbidden('You cannot modify this opportunity');

  const { stage } = req.body;
  if (!OPPORTUNITY_STAGES.includes(stage)) throw badRequest('Invalid stage');
  if (stage === row.stage) return ok(res, opportunityToJson(db.prepare(`${OPPORTUNITY_SELECT} WHERE o.id = ?`).get(row.id)));

  db.prepare("UPDATE opportunities SET stage = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(stage, row.id);

  const targetId = row.lead_id ?? row.customer_id;
  insertOpportunityActivity(db, {
    opportunityId: row.id,
    targetType: row.target_type,
    targetId,
    userId: req.user.id,
    type: 'stage',
    description: `Stage changed from ${row.stage} to ${stage}`,
    metadata: { from: row.stage, to: stage },
  });

  req.audit?.('pipeline.stage_change', {
    entityType: 'opportunity',
    entityId: row.id,
    metadata: { from: row.stage, to: stage },
  });

  const updated = db.prepare(`${OPPORTUNITY_SELECT} WHERE o.id = ?`).get(row.id);
  return ok(res, opportunityToJson(updated));
});

export const addOpportunityNote = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Opportunity not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessOpportunity(scope, row)) throw forbidden('You cannot modify this opportunity');

  const activityId = insertOpportunityActivity(db, {
    opportunityId: row.id,
    targetType: row.target_type,
    targetId: row.lead_id ?? row.customer_id,
    userId: req.user.id,
    type: 'note',
    description: req.body.note,
  });

  req.audit?.('pipeline.note', { entityType: 'opportunity', entityId: row.id });

  const activity = db
    .prepare(`SELECT a.*, u.name AS user_name FROM opportunity_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?`)
    .get(activityId);

  return ok(res, activityToJson(activity));
});

export const deleteOpportunity = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Opportunity not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessOpportunity(scope, row)) throw forbidden('You cannot delete this opportunity');

  db.prepare("UPDATE opportunities SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);

  req.audit?.('pipeline.delete', { entityType: 'opportunity', entityId: row.id, metadata: { opportunityNo: row.opportunity_no } });

  return ok(res, { id: row.id, deleted: true });
});
