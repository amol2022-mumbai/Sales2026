import { getDb } from '../db/connection.js';
import * as XLSX from 'xlsx';
import { notFound, forbidden, badRequest } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { hasPermission } from '../services/userService.js';
import {
  getUserDataScope,
  buildTargetScopeWhere,
  canAccessTarget,
  canAssignTargetTo,
  buildOpportunityScopeWhere,
  buildFollowUpScopeWhere,
} from '../services/access.js';
import {
  TARGET_SCOPES,
  TARGET_TYPES,
  TARGET_PERIODS,
  TARGET_STATUSES,
  withAchievement,
  getAchievementBreakdown,
} from '../services/targetService.js';

const TARGET_SELECT = `
  SELECT t.*, u.name AS user_name, tm.name AS team_name, cr.name AS created_by_name
  FROM targets t
  LEFT JOIN users u ON u.id = t.user_id
  LEFT JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN users cr ON cr.id = t.created_by
`;

const SORTABLE = {
  targetNo: 't.target_no',
  targetValue: 't.target_value',
  startDate: 't.start_date',
  endDate: 't.end_date',
  status: 't.status',
  targetType: 't.target_type',
  periodType: 't.period_type',
  createdAt: 't.created_at',
};

const COMPUTED_SORTS = new Set(['achievement', 'balance', 'achievementPct']);

function scopedTargetWhere(scope, extraClauses = [], extraParams = [], alias = 't') {
  const { where, params } = buildTargetScopeWhere(scope, alias);
  const clauses = [...extraClauses, `${alias}.deleted_at IS NULL`];
  const whereSql = where ? `${where} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;
  return { where: whereSql, params: [...params, ...extraParams] };
}

function targetToJson(t) {
  return {
    id: t.id,
    targetNo: t.target_no,
    companyId: t.company_id,
    scope: t.scope,
    userId: t.user_id,
    userName: t.user_name || null,
    teamId: t.team_id,
    teamName: t.team_name || null,
    product: t.product,
    territory: t.territory,
    targetType: t.target_type,
    periodType: t.period_type,
    targetValue: t.target_value,
    startDate: t.start_date,
    endDate: t.end_date,
    status: t.status,
    createdBy: t.created_by,
    createdByName: t.created_by_name || null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

function targetLabel(t) {
  if (t.scope === 'user') return t.userName || (t.userId ? `User #${t.userId}` : 'User');
  if (t.scope === 'team') return t.teamName || (t.teamId ? `Team #${t.teamId}` : 'Team');
  if (t.scope === 'product') return t.product;
  if (t.scope === 'territory') return t.territory;
  return 'Company';
}

function hydrate(db, rows) {
  return rows.map((r) => {
    const json = targetToJson(r);
    const { achievement, balance, achievementPct } = withAchievement(db, r);
    return { ...json, achievement, balance, achievementPct, label: targetLabel(json) };
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const listTargets = asyncHandler(async (req, res) => {
  const db = getDb();
  const {
    page, pageSize, search, scope: scopeFilter, targetType, periodType, status,
    userId, teamId, territory, companyId, dateFrom, dateTo, sort, order,
  } = req.query;
  const scope = getUserDataScope(req.user);

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(t.target_no LIKE ? OR t.product LIKE ? OR t.territory LIKE ? OR u.name LIKE ? OR tm.name LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (scopeFilter) {
    clauses.push('t.scope = ?');
    params.push(scopeFilter);
  }
  if (targetType) {
    clauses.push('t.target_type = ?');
    params.push(targetType);
  }
  if (periodType) {
    clauses.push('t.period_type = ?');
    params.push(periodType);
  }
  if (status) {
    clauses.push('t.status = ?');
    params.push(status);
  }
  if (userId) {
    clauses.push('t.user_id = ?');
    params.push(userId);
  }
  if (teamId) {
    clauses.push('t.team_id = ?');
    params.push(teamId);
  }
  if (territory) {
    clauses.push('t.territory = ?');
    params.push(territory);
  }
  if (companyId && req.user.isSuperAdmin) {
    clauses.push('t.company_id = ?');
    params.push(companyId);
  }
  if (dateFrom) {
    clauses.push('t.end_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('t.start_date <= ?');
    params.push(dateTo);
  }

  const { where, params: whereParams } = scopedTargetWhere(scope, clauses, params, 't');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM targets t LEFT JOIN users u ON u.id = t.user_id LEFT JOIN teams tm ON tm.id = t.team_id ${where}`).get(...whereParams).c;

  let data;
  if (COMPUTED_SORTS.has(sort)) {
    const all = db.prepare(`${TARGET_SELECT} ${where} LIMIT 10000`).all(...whereParams);
    const hydrated = hydrate(db, all);
    const dir = order === 'asc' ? 1 : -1;
    hydrated.sort((a, b) => (a[sort] - b[sort]) * dir || b.id - a.id);
    data = hydrated.slice((page - 1) * pageSize, page * pageSize);
  } else {
    const sortColumn = SORTABLE[sort] || 't.created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const rows = db
      .prepare(`${TARGET_SELECT} ${where} ORDER BY ${sortColumn} ${sortOrder}, t.id DESC LIMIT ? OFFSET ?`)
      .all(...whereParams, pageSize, (page - 1) * pageSize);
    data = hydrate(db, rows);
  }

  return paginated(res, data, { page, pageSize, total });
});

export const getTarget = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare(`${TARGET_SELECT} WHERE t.id = ?`).get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Target not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessTarget(scope, row)) throw forbidden('You cannot access this target');

  const json = targetToJson(row);
  const { achievement, balance, achievementPct } = withAchievement(db, row);
  json.achievement = achievement;
  json.balance = balance;
  json.achievementPct = achievementPct;
  json.label = targetLabel(json);
  json.breakdown = getAchievementBreakdown(db, row);

  return ok(res, json);
});

export const targetsMeta = asyncHandler(async (_req, res) => {
  return ok(res, {
    scopes: TARGET_SCOPES,
    types: TARGET_TYPES,
    periods: TARGET_PERIODS,
    statuses: TARGET_STATUSES,
  });
});

// ---------------------------------------------------------------------------
// Dashboard / scorecard / compare
// ---------------------------------------------------------------------------

export const targetsDashboard = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { targetType, scope: scopeFilter, teamId, userId, territory, dateFrom, dateTo } = req.query;

  const clauses = [];
  const params = [];
  if (targetType) {
    clauses.push('t.target_type = ?');
    params.push(targetType);
  }
  if (scopeFilter) {
    clauses.push('t.scope = ?');
    params.push(scopeFilter);
  }
  if (teamId) {
    clauses.push('t.team_id = ?');
    params.push(teamId);
  }
  if (userId) {
    clauses.push('t.user_id = ?');
    params.push(userId);
  }
  if (territory) {
    clauses.push('t.territory = ?');
    params.push(territory);
  }
  if (dateFrom) {
    clauses.push('t.end_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('t.start_date <= ?');
    params.push(dateTo);
  }

  const { where, params: whereParams } = scopedTargetWhere(scope, clauses, params, 't');
  const rows = db.prepare(`${TARGET_SELECT} ${where}`).all(...whereParams);
  const items = hydrate(db, rows);

  let targetValue = 0;
  let achievement = 0;
  const byTypeMap = {};
  const byScopeMap = {};
  for (const it of items) {
    targetValue += it.targetValue || 0;
    achievement += it.achievement || 0;

    byTypeMap[it.targetType] = byTypeMap[it.targetType] || { type: it.targetType, count: 0, targetValue: 0, achievement: 0 };
    byTypeMap[it.targetType].count += 1;
    byTypeMap[it.targetType].targetValue += it.targetValue || 0;
    byTypeMap[it.targetType].achievement += it.achievement || 0;

    byScopeMap[it.scope] = byScopeMap[it.scope] || { scope: it.scope, count: 0, targetValue: 0, achievement: 0 };
    byScopeMap[it.scope].count += 1;
    byScopeMap[it.scope].targetValue += it.targetValue || 0;
    byScopeMap[it.scope].achievement += it.achievement || 0;
  }

  const finalize = (entry) => {
    const balance = round2(entry.targetValue - entry.achievement);
    const achievementPct = entry.targetValue > 0 ? Math.round((entry.achievement / entry.targetValue) * 1000) / 10 : 0;
    return { ...entry, targetValue: round2(entry.targetValue), achievement: round2(entry.achievement), balance, achievementPct };
  };

  const byType = Object.values(byTypeMap).map(finalize);
  const byScope = Object.values(byScopeMap).map(finalize);
  const balance = round2(targetValue - achievement);
  const achievementPct = targetValue > 0 ? Math.round((achievement / targetValue) * 1000) / 10 : 0;

  const ranking = [...items]
    .sort((a, b) => b.achievementPct - a.achievementPct || b.achievement - a.achievement)
    .slice(0, 20)
    .map((it) => ({
      targetId: it.id,
      targetNo: it.targetNo,
      label: it.label,
      scope: it.scope,
      type: it.targetType,
      targetValue: it.targetValue,
      achievement: it.achievement,
      balance: it.balance,
      achievementPct: it.achievementPct,
    }));

  // Pipeline contribution (real opportunities data).
  const oppClauses = [];
  const oppParams = [];
  if (dateFrom) {
    oppClauses.push('o.expected_close_date >= ?');
    oppParams.push(dateFrom);
  }
  if (dateTo) {
    oppClauses.push('o.expected_close_date <= ?');
    oppParams.push(dateTo);
  }
  const oppWhere = scopedWhere(buildOpportunityScopeWhere, scope, 'o', oppClauses, oppParams);
  const pipeline = db
    .prepare(
      `SELECT
         SUM(CASE WHEN stage NOT IN ('Won','Lost') THEN deal_value ELSE 0 END) AS open_value,
         SUM(CASE WHEN stage NOT IN ('Won','Lost') THEN deal_value * probability / 100.0 ELSE 0 END) AS weighted_value,
         SUM(CASE WHEN stage = 'Won' THEN deal_value ELSE 0 END) AS won_value,
         SUM(CASE WHEN stage = 'Lost' THEN deal_value ELSE 0 END) AS lost_value
       FROM opportunities o ${oppWhere.where}`
    )
    .get(...oppWhere.params);
  const wonCount = db.prepare(`SELECT COUNT(*) AS c FROM opportunities o ${oppWhere.where} AND o.stage = 'Won'`).get(...oppWhere.params).c;
  const lostCount = db.prepare(`SELECT COUNT(*) AS c FROM opportunities o ${oppWhere.where} AND o.stage = 'Lost'`).get(...oppWhere.params).c;
  const closedCount = wonCount + lostCount;
  const conversionRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 1000) / 10 : 0;

  // Activities (completed follow-ups).
  const fupClauses = [];
  const fupParams = [];
  if (dateFrom) {
    fupClauses.push('f.follow_up_date >= ?');
    fupParams.push(dateFrom);
  }
  if (dateTo) {
    fupClauses.push('f.follow_up_date <= ?');
    fupParams.push(dateTo);
  }
  const fupWhere = scopedWhere(buildFollowUpScopeWhere, scope, 'f', fupClauses, fupParams);
  const activities = db
    .prepare(
      `SELECT
         SUM(CASE WHEN f.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN f.status = 'Pending' THEN 1 ELSE 0 END) AS pending,
         COUNT(*) AS total
       FROM follow_ups f ${fupWhere.where}`
    )
    .get(...fupWhere.params);

  return ok(res, {
    summary: {
      totalTargets: items.length,
      activeTargets: items.filter((i) => i.status === 'Active').length,
      targetValue: round2(targetValue),
      achievement: round2(achievement),
      balance,
      achievementPct,
    },
    byType,
    byScope,
    ranking,
    pipeline: {
      openValue: round2(pipeline.open_value || 0),
      weightedValue: round2(pipeline.weighted_value || 0),
      wonValue: round2(pipeline.won_value || 0),
      lostValue: round2(pipeline.lost_value || 0),
      conversionRate,
    },
    activities: {
      completed: activities.completed || 0,
      pending: activities.pending || 0,
      total: activities.total || 0,
    },
    collections: { achieved: 0 },
  });
});

function scopedWhere(buildFn, scope, alias, extraClauses = [], extraParams = []) {
  const { where, params } = buildFn(scope, alias);
  const clauses = [...extraClauses, `${alias}.deleted_at IS NULL`];
  const whereSql = where ? `${where} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;
  return { where: whereSql, params: [...params, ...extraParams] };
}

function bucketFor(dateStr, groupBy) {
  const d = dateStr.slice(0, 10);
  if (groupBy === 'day') return d;
  if (groupBy === 'year') return d.slice(0, 4);
  if (groupBy === 'month') return d.slice(0, 7);
  // quarter
  const month = Number(d.slice(5, 7));
  return `${d.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

export const targetsScorecard = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const userId = req.query.userId ? Number(req.query.userId) : req.user.id;
  const groupBy = ['day', 'month', 'quarter', 'year'].includes(req.query.groupBy) ? req.query.groupBy : 'month';
  const dateFrom = req.query.dateFrom || '0000-01-01';
  const dateTo = req.query.dateTo || '9999-12-31';

  const user = db
    .prepare('SELECT id, name, email, territory, team_id, company_id, (SELECT name FROM teams WHERE id = users.team_id) AS team_name FROM users WHERE id = ?')
    .get(userId);
  if (!user) throw notFound('User not found');
  if (user.id !== req.user.id && scope.type !== 'all' && !canAssignTargetTo(scope, user)) {
    throw forbidden('You cannot view this scorecard');
  }

  // Targets owned by this salesperson (user-scoped) plus their team targets
  // where the person is the measured individual is user-scoped only.
  const targetRows = db
    .prepare(
      `SELECT t.*, u.name AS user_name, tm.name AS team_name
       FROM targets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN teams tm ON tm.id = t.team_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL
         AND t.end_date >= ? AND t.start_date <= ?
       ORDER BY t.start_date ASC`
    )
    .all(userId, dateFrom, dateTo);
  const targets = hydrate(db, targetRows);

  // Raw source rows for the time series.
  const oppRows = db
    .prepare(
      `SELECT o.deal_value, o.stage, o.expected_close_date
       FROM opportunities o
       WHERE o.company_id = ? AND o.assigned_to = ? AND o.deleted_at IS NULL
         AND o.stage IN ('Won','Lost') AND o.expected_close_date BETWEEN ? AND ?`
    )
    .all(user.company_id ?? scope.companyId ?? null, userId, dateFrom, dateTo);
  const leadRows = db
    .prepare(
      `SELECT date(l.created_at) AS d FROM leads l
       WHERE l.company_id = ? AND l.assigned_to = ? AND l.deleted_at IS NULL
         AND date(l.created_at) BETWEEN ? AND ?`
    )
    .all(user.company_id ?? scope.companyId ?? null, userId, dateFrom, dateTo);
  const customerRows = db
    .prepare(
      `SELECT date(c.created_at) AS d FROM customers c
       WHERE c.company_id = ? AND c.assigned_to = ? AND c.deleted_at IS NULL
         AND date(c.created_at) BETWEEN ? AND ?`
    )
    .all(user.company_id ?? scope.companyId ?? null, userId, dateFrom, dateTo);
  const fupRows = db
    .prepare(
      `SELECT f.follow_up_date FROM follow_ups f
       WHERE f.company_id = ? AND f.assigned_to = ? AND f.deleted_at IS NULL AND f.status = 'Completed'
         AND f.follow_up_date BETWEEN ? AND ?`
    )
    .all(user.company_id ?? scope.companyId ?? null, userId, dateFrom, dateTo);

  const seriesMap = new Map();
  const bump = (bucket, key, value) => {
    if (!seriesMap.has(bucket)) seriesMap.set(bucket, { bucket, sales: 0, newLeads: 0, newCustomers: 0, activities: 0, won: 0, closed: 0 });
    const b = seriesMap.get(bucket);
    b[key] = (b[key] || 0) + (value || 0);
  };
  for (const r of oppRows) {
    const bucket = bucketFor(r.expected_close_date, groupBy);
    if (r.stage === 'Won') {
      bump(bucket, 'sales', r.deal_value);
      bump(bucket, 'won', 1);
      bump(bucket, 'closed', 1);
    } else {
      bump(bucket, 'closed', 1);
    }
  }
  for (const r of leadRows) bump(bucketFor(r.d, groupBy), 'newLeads', 1);
  for (const r of customerRows) bump(bucketFor(r.d, groupBy), 'newCustomers', 1);
  for (const r of fupRows) bump(bucketFor(r.follow_up_date, groupBy), 'activities', 1);

  const series = [...seriesMap.values()]
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map((b) => ({
      ...b,
      conversionRate: b.closed > 0 ? Math.round((b.won / b.closed) * 1000) / 10 : 0,
      collections: 0,
    }));

  const totals = {
    sales: round2(series.reduce((s, b) => s + b.sales, 0)),
    newLeads: series.reduce((s, b) => s + b.newLeads, 0),
    newCustomers: series.reduce((s, b) => s + b.newCustomers, 0),
    activities: series.reduce((s, b) => s + b.activities, 0),
    collections: 0,
  };

  return ok(res, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      territory: user.territory,
      teamId: user.team_id,
      teamName: user.team_name || null,
    },
    period: { dateFrom, dateTo, groupBy },
    targets,
    series,
    totals,
  });
});

export const targetsCompare = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const teamId = req.query.teamId ? Number(req.query.teamId) : null;

  const userClauses = [];
  const userParams = [];
  if (teamId) {
    userClauses.push('u.team_id = ?');
    userParams.push(teamId);
  } else if (scope.type === 'teams' || scope.type === 'team') {
    if (scope.teamIds.length) {
      userClauses.push(`u.team_id IN (${scope.teamIds.map(() => '?').join(', ')})`);
      userParams.push(...scope.teamIds);
    } else {
      userClauses.push('u.id = ?');
      userParams.push(scope.selfId);
    }
  } else if (scope.type === 'self') {
    userClauses.push('u.id = ?');
    userParams.push(scope.selfId);
  } else if (scope.type === 'company') {
    userClauses.push('u.company_id = ?');
    userParams.push(scope.companyId);
  }

  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.territory, u.team_id, tm.name AS team_name
       FROM users u LEFT JOIN teams tm ON tm.id = u.team_id
       WHERE ${userClauses.join(' AND ') || '1'} AND u.status = 'active'
       ORDER BY u.name ASC`
    )
    .all(...userParams);

  const members = [];
  for (const u of users) {
    const targetRows = db
      .prepare(`SELECT t.* FROM targets t WHERE t.user_id = ? AND t.deleted_at IS NULL`)
      .all(u.id);
    const hydrated = hydrate(db, targetRows);
    const targetValue = round2(hydrated.reduce((s, t) => s + (t.targetValue || 0), 0));
    const achievement = round2(hydrated.reduce((s, t) => s + (t.achievement || 0), 0));
    const balance = round2(targetValue - achievement);
    const achievementPct = targetValue > 0 ? Math.round((achievement / targetValue) * 1000) / 10 : 0;
    members.push({
      userId: u.id,
      name: u.name,
      email: u.email,
      territory: u.territory,
      teamId: u.team_id,
      teamName: u.team_name || null,
      targets: hydrated.length,
      targetValue,
      achievement,
      balance,
      achievementPct,
      belowTarget: achievementPct < 100,
    });
  }

  members.sort((a, b) => b.achievementPct - a.achievementPct);

  return ok(res, { members, teamId });
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function resolveTargetCompany(req) {
  if (req.user.isSuperAdmin) return req.body.companyId ?? null;
  return req.user.companyId;
}

/** Validate scope/entity choices and return normalized values. */
function resolveTargetEntity(db, req, scope, companyId, b) {
  const targetScope = b.scope;
  const userId = b.userId ?? null;
  const teamId = b.teamId ?? null;
  const product = b.product ?? null;
  const territory = b.territory ?? null;

  if (targetScope === 'user') {
    if (!userId) throw badRequest('A salesperson is required for a user target');
    const u = db.prepare('SELECT id, company_id, team_id FROM users WHERE id = ?').get(userId);
    if (!u || u.company_id !== companyId) throw badRequest('Invalid salesperson');
    if (userId !== req.user.id && !hasPermission(req.user, 'targets:assign')) {
      throw forbidden('You do not have permission to set targets for others');
    }
    if (!canAssignTargetTo(scope, u)) throw forbidden('You can only set targets within your scope');
    return { scope: 'user', userId, teamId: u.team_id ?? null, product: null, territory: null };
  }

  if (targetScope === 'team') {
    if (!teamId) throw badRequest('A team is required for a team target');
    const t = db.prepare('SELECT id, company_id FROM teams WHERE id = ?').get(teamId);
    if (!t || t.company_id !== companyId) throw badRequest('Invalid team');
    if (scope.type === 'teams' || scope.type === 'team') {
      if (!scope.teamIds.includes(teamId)) throw forbidden('You can only set targets for teams you manage');
    } else if (scope.type === 'self' && teamId !== req.user.teamId) {
      throw forbidden('You can only set targets for your own team');
    }
    return { scope: 'team', userId: null, teamId, product: null, territory: null };
  }

  // company / product / territory are organisation-level targets.
  if (!hasPermission(req.user, 'targets:assign')) {
    throw forbidden('You do not have permission to create organisation-level targets');
  }
  if (targetScope === 'product') {
    if (!product) throw badRequest('A product/service is required for a product target');
    return { scope: 'product', userId: null, teamId: null, product, territory: null };
  }
  if (targetScope === 'territory') {
    if (!territory) throw badRequest('A territory is required for a territory target');
    return { scope: 'territory', userId: null, teamId: null, product: null, territory };
  }
  return { scope: 'company', userId: null, teamId: null, product: null, territory: null };
}

export const createTarget = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const b = req.body;
  const companyId = resolveTargetCompany(req);
  if (!companyId) throw badRequest('A company is required to create a target');

  const entity = resolveTargetEntity(db, req, scope, companyId, b);

  const info = db
    .prepare(
      `INSERT INTO targets (company_id, scope, user_id, team_id, product, territory, target_type, period_type,
                            target_value, start_date, end_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      companyId,
      entity.scope,
      entity.userId,
      entity.teamId,
      entity.product,
      entity.territory,
      b.targetType,
      b.periodType,
      b.targetValue,
      b.startDate,
      b.endDate,
      b.status ?? 'Active',
      req.user.id
    );
  const targetId = Number(info.lastInsertRowid);
  const targetNo = `TGT-${String(targetId).padStart(6, '0')}`;
  db.prepare('UPDATE targets SET target_no = ? WHERE id = ?').run(targetNo, targetId);

  req.audit?.('target.create', {
    entityType: 'target',
    entityId: targetId,
    metadata: { scope: entity.scope, targetType: b.targetType, targetValue: b.targetValue },
  });

  const row = db.prepare(`${TARGET_SELECT} WHERE t.id = ?`).get(targetId);
  return created(res, targetToJson(row));
});

export const updateTarget = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Target not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessTarget(scope, row)) throw forbidden('You cannot modify this target');

  const b = req.body;
  const sets = [];
  const values = [];

  // Re-validate scope/entity only if the scope itself changed.
  if (b.scope && b.scope !== row.scope) {
    const entity = resolveTargetEntity(db, req, scope, row.company_id, { ...b, scope: b.scope });
    sets.push('scope = ?');
    values.push(entity.scope);
    sets.push('user_id = ?');
    values.push(entity.userId);
    sets.push('team_id = ?');
    values.push(entity.teamId);
    sets.push('product = ?');
    values.push(entity.product);
    sets.push('territory = ?');
    values.push(entity.territory);
  } else if (b.scope && b.scope === row.scope) {
    // Same scope but entity may change (e.g. reassign user target).
    const entity = resolveTargetEntity(db, req, scope, row.company_id, { ...b, scope: b.scope });
    for (const [col, val] of [
      ['user_id', entity.userId],
      ['team_id', entity.teamId],
      ['product', entity.product],
      ['territory', entity.territory],
    ]) {
      sets.push(`${col} = ?`);
      values.push(val);
    }
  }

  const fieldMap = {
    targetType: 'target_type',
    periodType: 'period_type',
    targetValue: 'target_value',
    startDate: 'start_date',
    endDate: 'end_date',
    status: 'status',
  };
  for (const [input, column] of Object.entries(fieldMap)) {
    if (b[input] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(b[input]);
    }
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE targets SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  req.audit?.('target.update', { entityType: 'target', entityId: row.id });

  const updated = db.prepare(`${TARGET_SELECT} WHERE t.id = ?`).get(row.id);
  return ok(res, targetToJson(updated));
});

export const deleteTarget = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Target not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessTarget(scope, row)) throw forbidden('You cannot delete this target');

  db.prepare("UPDATE targets SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);

  req.audit?.('target.delete', { entityType: 'target', entityId: row.id, metadata: { targetNo: row.target_no } });

  return ok(res, { id: row.id, deleted: true });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const exportTargets = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { search, targetType, scope: scopeFilter, periodType, status, teamId, userId, territory, format } = req.query;

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(t.target_no LIKE ? OR t.product LIKE ? OR t.territory LIKE ? OR u.name LIKE ? OR tm.name LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (targetType) {
    clauses.push('t.target_type = ?');
    params.push(targetType);
  }
  if (scopeFilter) {
    clauses.push('t.scope = ?');
    params.push(scopeFilter);
  }
  if (periodType) {
    clauses.push('t.period_type = ?');
    params.push(periodType);
  }
  if (status) {
    clauses.push('t.status = ?');
    params.push(status);
  }
  if (teamId) {
    clauses.push('t.team_id = ?');
    params.push(teamId);
  }
  if (userId) {
    clauses.push('t.user_id = ?');
    params.push(userId);
  }
  if (territory) {
    clauses.push('t.territory = ?');
    params.push(territory);
  }

  const { where, params: whereParams } = scopedTargetWhere(scope, clauses, params, 't');
  const rows = db.prepare(`${TARGET_SELECT} ${where} ORDER BY t.id DESC LIMIT 100000`).all(...whereParams);
  const items = hydrate(db, rows).map((t) => ({
    targetNo: t.targetNo,
    scope: t.scope,
    label: t.label,
    targetType: t.targetType,
    periodType: t.periodType,
    targetValue: t.targetValue,
    startDate: t.startDate,
    endDate: t.endDate,
    status: t.status,
    achievement: t.achievement,
    balance: t.balance,
    achievementPct: t.achievementPct,
  }));

  req.audit?.('target.export', { entityType: 'target', metadata: { count: items.length } });

  if (format === 'xlsx') {
    const columns = [
      ['targetNo', 'Target ID'],
      ['scope', 'Scope'],
      ['label', 'Entity'],
      ['targetType', 'Target Type'],
      ['periodType', 'Period'],
      ['targetValue', 'Target Value'],
      ['startDate', 'Start Date'],
      ['endDate', 'End Date'],
      ['status', 'Status'],
      ['achievement', 'Achievement'],
      ['balance', 'Balance'],
      ['achievementPct', 'Achievement %'],
    ];
    const aoa = [columns.map(([, l]) => l), ...items.map((t) => columns.map(([k]) => (t[k] == null ? '' : t[k])))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Targets');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="targets.xlsx"');
    return res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  const csvColumns = [
    ['targetNo', 'Target ID'],
    ['scope', 'Scope'],
    ['label', 'Entity'],
    ['targetType', 'Target Type'],
    ['periodType', 'Period'],
    ['targetValue', 'Target Value'],
    ['startDate', 'Start Date'],
    ['endDate', 'End Date'],
    ['status', 'Status'],
    ['achievement', 'Achievement'],
    ['balance', 'Balance'],
    ['achievementPct', 'Achievement %'],
  ];
  const escape = (v) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    csvColumns.map(([, l]) => l),
    ...items.map((t) => csvColumns.map(([k]) => (t[k] == null ? '' : t[k]))),
  ];
  const csv = '\uFEFF' + lines.map((r) => r.map(escape).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="targets.csv"');
  return res.send(csv);
});
