// ============================================================================
// Report service. Pure, tenant-scoped computation of every report and MIS
// metric from real source data (leads, customers, opportunities, follow-ups,
// targets, invoices, payments). Never fabricates numbers. Every query is
// scoped by company_id; the caller supplies the trusted companyId (derived
// server-side from the authenticated user — never from client input).
// ============================================================================

import { computeActual } from './targetService.js';
import { invoicePaidByInvoiceIds } from './collectionService.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const PERIODS = ['day', 'month', 'quarter', 'year'];

export const REPORT_TYPES = [
  'sales',
  'lead-conversion',
  'follow-ups',
  'pipeline',
  'target-achievement',
  'customers',
  'products',
  'territories',
  'collections',
  'aging',
  'won-lost',
  'productivity',
];

// ---------------------------------------------------------------------------
// Shared filter helpers
// ---------------------------------------------------------------------------

/**
 * Build a scope restriction fragment for records that carry an `assigned_to`
 * and `team_id` (opportunities, leads, customers, follow-ups, invoices).
 * Derived from getUserDataScope so a sales executive sees only their own rows
 * and a team leader only their team(s) plus self — never the whole company.
 * Returns null for company / all scopes (company filter already applies).
 */
function assignmentScope(ctx, alias) {
  const s = ctx.scope;
  if (!s) return null;
  if (s.type === 'self') return { sql: `${alias}.assigned_to = ?`, params: [s.selfId] };
  if (s.type === 'team' || s.type === 'teams') {
    if (!s.teamIds.length) return { sql: `${alias}.assigned_to = ?`, params: [s.selfId] };
    const ph = s.teamIds.map(() => '?').join(', ');
    return { sql: `(${alias}.team_id IN (${ph}) OR ${alias}.assigned_to = ?)`, params: [...s.teamIds, s.selfId] };
  }
  return null;
}

/**
 * Scope restriction for the `targets` table, mirroring buildTargetScopeWhere.
 */
function targetAssignmentScope(ctx) {
  const s = ctx.scope;
  if (!s) return null;
  if (s.type === 'self') return { sql: 't.user_id = ?', params: [s.selfId] };
  if (s.type === 'team') {
    if (!s.teamIds.length) return { sql: 't.user_id = ?', params: [s.selfId] };
    const ph = s.teamIds.map(() => '?').join(', ');
    return { sql: `(t.team_id IN (${ph}) OR t.user_id = ?)`, params: [...s.teamIds, s.selfId] };
  }
  if (s.type === 'teams') {
    if (!s.teamIds.length) return { sql: `(t.user_id = ? OR t.scope IN ('company','product','territory'))`, params: [s.selfId] };
    const ph = s.teamIds.map(() => '?').join(', ');
    return { sql: `(t.team_id IN (${ph}) OR t.user_id = ? OR t.scope IN ('company','product','territory'))`, params: [...s.teamIds, s.selfId] };
  }
  return null;
}

function oppWhere(ctx, { alias = 'o', dateColumn = 'expected_close_date', companyFilter = true } = {}) {
  const parts = [];
  const params = [];
  if (companyFilter) {
    parts.push(`${alias}.company_id = ?`);
    params.push(ctx.companyId);
  }
  const scope = assignmentScope(ctx, alias);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (ctx.salespersonId) {
    parts.push(`${alias}.assigned_to = ?`);
    params.push(ctx.salespersonId);
  }
  if (ctx.teamId) {
    parts.push(`${alias}.team_id = ?`);
    params.push(ctx.teamId);
  }
  if (ctx.product) {
    parts.push(`${alias}.product_service = ?`);
    params.push(ctx.product);
  }
  if (ctx.territory) {
    parts.push(`${alias}.assigned_to IN (SELECT id FROM users WHERE company_id = ? AND territory = ?)`);
    params.push(ctx.companyId, ctx.territory);
  }
  if (ctx.from) {
    parts.push(`date(${alias}.${dateColumn}) >= date(?)`);
    params.push(ctx.from);
  }
  if (ctx.to) {
    parts.push(`date(${alias}.${dateColumn}) <= date(?)`);
    params.push(ctx.to);
  }
  parts.push(`${alias}.deleted_at IS NULL`);
  return { sql: parts.join(' AND '), params };
}

function leadWhere(ctx, { alias = 'l', dateColumn = 'created_at' } = {}) {
  const parts = [];
  const params = [];
  parts.push(`${alias}.company_id = ?`);
  params.push(ctx.companyId);
  const scope = assignmentScope(ctx, alias);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (ctx.salespersonId) {
    parts.push(`${alias}.assigned_to = ?`);
    params.push(ctx.salespersonId);
  }
  if (ctx.teamId) {
    parts.push(`${alias}.team_id = ?`);
    params.push(ctx.teamId);
  }
  if (ctx.product) {
    parts.push(`${alias}.product_service = ?`);
    params.push(ctx.product);
  }
  if (ctx.territory) {
    parts.push(`${alias}.assigned_to IN (SELECT id FROM users WHERE company_id = ? AND territory = ?)`);
    params.push(ctx.companyId, ctx.territory);
  }
  if (ctx.status) {
    parts.push(`${alias}.status = ?`);
    params.push(ctx.status);
  }
  if (ctx.from) {
    parts.push(`date(${alias}.${dateColumn}) >= date(?)`);
    params.push(ctx.from);
  }
  if (ctx.to) {
    parts.push(`date(${alias}.${dateColumn}) <= date(?)`);
    params.push(ctx.to);
  }
  parts.push(`${alias}.deleted_at IS NULL`);
  return { sql: parts.join(' AND '), params };
}

function customerWhere(ctx, { alias = 'c', dateColumn = 'created_at' } = {}) {
  const parts = [];
  const params = [];
  parts.push(`${alias}.company_id = ?`);
  params.push(ctx.companyId);
  const scope = assignmentScope(ctx, alias);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (ctx.salespersonId) {
    parts.push(`${alias}.assigned_to = ?`);
    params.push(ctx.salespersonId);
  }
  if (ctx.teamId) {
    parts.push(`${alias}.team_id = ?`);
    params.push(ctx.teamId);
  }
  if (ctx.territory) {
    parts.push(`${alias}.assigned_to IN (SELECT id FROM users WHERE company_id = ? AND territory = ?)`);
    params.push(ctx.companyId, ctx.territory);
  }
  if (ctx.status) {
    parts.push(`${alias}.status = ?`);
    params.push(ctx.status);
  }
  if (ctx.from) {
    parts.push(`date(${alias}.${dateColumn}) >= date(?)`);
    params.push(ctx.from);
  }
  if (ctx.to) {
    parts.push(`date(${alias}.${dateColumn}) <= date(?)`);
    params.push(ctx.to);
  }
  parts.push(`${alias}.deleted_at IS NULL`);
  return { sql: parts.join(' AND '), params };
}

function followUpWhere(ctx, { alias = 'f' } = {}) {
  const parts = [];
  const params = [];
  parts.push(`${alias}.company_id = ?`);
  params.push(ctx.companyId);
  const scope = assignmentScope(ctx, alias);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (ctx.salespersonId) {
    parts.push(`${alias}.assigned_to = ?`);
    params.push(ctx.salespersonId);
  }
  if (ctx.teamId) {
    parts.push(`${alias}.team_id = ?`);
    params.push(ctx.teamId);
  }
  if (ctx.territory) {
    parts.push(`${alias}.assigned_to IN (SELECT id FROM users WHERE company_id = ? AND territory = ?)`);
    params.push(ctx.companyId, ctx.territory);
  }
  if (ctx.status) {
    parts.push(`${alias}.status = ?`);
    params.push(ctx.status);
  }
  if (ctx.from) {
    parts.push(`date(${alias}.follow_up_date) >= date(?)`);
    params.push(ctx.from);
  }
  if (ctx.to) {
    parts.push(`date(${alias}.follow_up_date) <= date(?)`);
    params.push(ctx.to);
  }
  parts.push(`${alias}.deleted_at IS NULL`);
  return { sql: parts.join(' AND '), params };
}

function invoiceWhere(ctx, { alias = 'i', dateColumn = 'created_at' } = {}) {
  const parts = [];
  const params = [];
  parts.push(`${alias}.company_id = ?`);
  params.push(ctx.companyId);
  const scope = assignmentScope(ctx, alias);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (ctx.salespersonId) {
    parts.push(`${alias}.assigned_to = ?`);
    params.push(ctx.salespersonId);
  }
  if (ctx.teamId) {
    parts.push(`${alias}.team_id = ?`);
    params.push(ctx.teamId);
  }
  if (ctx.territory) {
    parts.push(`${alias}.assigned_to IN (SELECT id FROM users WHERE company_id = ? AND territory = ?)`);
    params.push(ctx.companyId, ctx.territory);
  }
  if (ctx.from) {
    parts.push(`date(${alias}.${dateColumn}) >= date(?)`);
    params.push(ctx.from);
  }
  if (ctx.to) {
    parts.push(`date(${alias}.${dateColumn}) <= date(?)`);
    params.push(ctx.to);
  }
  parts.push(`${alias}.deleted_at IS NULL`);
  return { sql: parts.join(' AND '), params };
}

function paymentWhere(ctx, { alias = 'p', invoiceAlias = 'i' } = {}) {
  const parts = [];
  const params = [];
  parts.push(`${alias}.company_id = ?`);
  params.push(ctx.companyId);
  const scope = assignmentScope(ctx, invoiceAlias);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (ctx.salespersonId) {
    parts.push(`${invoiceAlias}.assigned_to = ?`);
    params.push(ctx.salespersonId);
  }
  if (ctx.teamId) {
    parts.push(`${invoiceAlias}.team_id = ?`);
    params.push(ctx.teamId);
  }
  if (ctx.territory) {
    parts.push(`${invoiceAlias}.assigned_to IN (SELECT id FROM users WHERE company_id = ? AND territory = ?)`);
    params.push(ctx.companyId, ctx.territory);
  }
  if (ctx.from) {
    parts.push(`date(${alias}.payment_date) >= date(?)`);
    params.push(ctx.from);
  }
  if (ctx.to) {
    parts.push(`date(${alias}.payment_date) <= date(?)`);
    params.push(ctx.to);
  }
  parts.push(`${alias}.deleted_at IS NULL`);
  return { sql: parts.join(' AND '), params };
}

// ---------------------------------------------------------------------------
// Period bucketing
// ---------------------------------------------------------------------------
function periodKey(dateStr, period) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (period === 'year') return `${y}`;
  if (period === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (period === 'month') return `${y}-${String(m).padStart(2, '0')}`;
  return dateStr.slice(0, 10);
}

function bucketize(rows, period, dateFn) {
  const buckets = new Map();
  for (const r of rows) {
    const key = period ? periodKey(dateFn(r), period) : 'total';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const entries = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!period) return entries.map(([key, list]) => ({ bucket: 'Total', list }));
  return entries.map(([key, list]) => ({ bucket: key, list }));
}

// ---------------------------------------------------------------------------
// Individual reports
// ---------------------------------------------------------------------------
function salesReport(db, ctx) {
  const { sql, params } = oppWhere(ctx, {});
  const rows = db
    .prepare(
      `SELECT o.expected_close_date, o.deal_value FROM opportunities o WHERE ${sql} AND o.stage = 'Won'`
    )
    .all(...params);
  const buckets = bucketize(rows, ctx.period, (r) => r.expected_close_date || '');
  const data = buckets.map((b) => ({
    period: b.bucket,
    sales: r2(b.list.reduce((s, r) => s + (r.deal_value || 0), 0)),
    count: b.list.length,
  }));
  return {
    columns: [
      { key: 'period', label: 'Period', format: 'text' },
      { key: 'sales', label: 'Sales', format: 'currency' },
      { key: 'count', label: 'Deals Won', format: 'number' },
    ],
    rows: data,
  };
}

function leadConversionReport(db, ctx) {
  const { sql, params } = leadWhere(ctx, {});
  const rows = db
    .prepare(
      `SELECT l.created_at, l.status FROM leads l WHERE ${sql}`
    )
    .all(...params);
  const buckets = bucketize(rows, ctx.period, (r) => r.created_at);
  const data = buckets.map((b) => {
    const total = b.list.length;
    const won = b.list.filter((r) => r.status === 'Won').length;
    const lost = b.list.filter((r) => r.status === 'Lost').length;
    const closed = won + lost;
    return {
      period: b.bucket,
      leads: total,
      won,
      lost,
      conversionRate: closed > 0 ? r2((won / closed) * 100) : 0,
    };
  });
  return {
    columns: [
      { key: 'period', label: 'Period', format: 'text' },
      { key: 'leads', label: 'Leads', format: 'number' },
      { key: 'won', label: 'Won', format: 'number' },
      { key: 'lost', label: 'Lost', format: 'number' },
      { key: 'conversionRate', label: 'Conversion %', format: 'percent' },
    ],
    rows: data,
  };
}

function followUpsReport(db, ctx) {
  const { sql, params } = followUpWhere(ctx, {});
  const rows = db
    .prepare(`SELECT f.follow_up_date, f.status FROM follow_ups f WHERE ${sql}`)
    .all(...params);
  const buckets = bucketize(rows, ctx.period, (r) => r.follow_up_date);
  const data = buckets.map((b) => {
    const scheduled = b.list.length;
    const completed = b.list.filter((r) => r.status === 'Completed').length;
    const pending = b.list.filter((r) => r.status === 'Pending').length;
    return {
      period: b.bucket,
      scheduled,
      completed,
      pending,
      completionRate: scheduled > 0 ? r2((completed / scheduled) * 100) : 0,
    };
  });
  return {
    columns: [
      { key: 'period', label: 'Period', format: 'text' },
      { key: 'scheduled', label: 'Scheduled', format: 'number' },
      { key: 'completed', label: 'Completed', format: 'number' },
      { key: 'pending', label: 'Pending', format: 'number' },
      { key: 'completionRate', label: 'Completion %', format: 'percent' },
    ],
    rows: data,
  };
}

function pipelineReport(db, ctx) {
  const { sql, params } = oppWhere(ctx, {});
  const rows = db
    .prepare(
      `SELECT o.stage, o.deal_value, o.probability FROM opportunities o WHERE ${sql} AND o.stage NOT IN ('Won','Lost')`
    )
    .all(...params);
  const byStage = new Map();
  for (const r of rows) {
    if (!byStage.has(r.stage)) byStage.set(r.stage, { count: 0, value: 0, weighted: 0 });
    const s = byStage.get(r.stage);
    s.count += 1;
    s.value += r.deal_value || 0;
    s.weighted += ((r.deal_value || 0) * (r.probability || 0)) / 100;
  }
  const data = [...byStage.entries()].map(([stage, s]) => ({
    stage,
    count: s.count,
    value: r2(s.value),
    weighted: r2(s.weighted),
  }));
  return {
    columns: [
      { key: 'stage', label: 'Stage', format: 'text' },
      { key: 'count', label: 'Deals', format: 'number' },
      { key: 'value', label: 'Value', format: 'currency' },
      { key: 'weighted', label: 'Weighted Value', format: 'currency' },
    ],
    rows: data,
  };
}

function targetAchievementReport(db, ctx) {
  const parts = ['t.company_id = ?', 't.deleted_at IS NULL'];
  const params = [ctx.companyId];
  const scope = targetAssignmentScope(ctx);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (ctx.status) {
    parts.push('t.status = ?');
    params.push(ctx.status);
  }
  if (ctx.salespersonId) {
    parts.push('t.user_id = ?');
    params.push(ctx.salespersonId);
  }
  if (ctx.teamId) {
    parts.push('t.team_id = ?');
    params.push(ctx.teamId);
  }
  if (ctx.product) {
    parts.push('t.product = ?');
    params.push(ctx.product);
  }
  if (ctx.territory) {
    parts.push('t.territory = ?');
    params.push(ctx.territory);
  }
  const rows = db
    .prepare(`SELECT * FROM targets t WHERE ${parts.join(' AND ')} ORDER BY t.start_date, t.id`)
    .all(...params);

  const data = rows.map((t) => {
    const { achievement, balance, achievementPct } = computeAchievement(db, t);
    return {
      targetNo: t.target_no,
      type: t.target_type,
      scope: t.scope,
      label: targetLabel(db, t),
      periodType: t.period_type,
      startDate: t.start_date,
      endDate: t.end_date,
      targetValue: t.target_value,
      achievement,
      balance,
      achievementPct,
      status: t.status,
    };
  });
  return {
    columns: [
      { key: 'targetNo', label: 'Target', format: 'text' },
      { key: 'label', label: 'Entity', format: 'text' },
      { key: 'type', label: 'Type', format: 'text' },
      { key: 'periodType', label: 'Period', format: 'text' },
      { key: 'targetValue', label: 'Target Value', format: 'currency' },
      { key: 'achievement', label: 'Achievement', format: 'currency' },
      { key: 'balance', label: 'Balance', format: 'currency' },
      { key: 'achievementPct', label: 'Achievement %', format: 'percent' },
      { key: 'status', label: 'Status', format: 'text' },
    ],
    rows: data,
  };
}

function computeAchievement(db, t) {
  const achievement = computeActual(db, t);
  const targetValue = Number(t.target_value) || 0;
  const balance = r2(targetValue - achievement);
  const achievementPct = targetValue > 0 ? r2((achievement / targetValue) * 100) : 0;
  return { achievement, balance, achievementPct };
}

function targetLabel(db, t) {
  if (t.scope === 'user' && t.user_id) {
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(t.user_id);
    return u?.name || `User ${t.user_id}`;
  }
  if (t.scope === 'team' && t.team_id) {
    const tm = db.prepare('SELECT name FROM teams WHERE id = ?').get(t.team_id);
    return tm?.name || `Team ${t.team_id}`;
  }
  if (t.scope === 'product' && t.product) return t.product;
  if (t.scope === 'territory' && t.territory) return t.territory;
  return 'Company';
}

function customersReport(db, ctx) {
  const { sql, params } = customerWhere(ctx, {});
  const rows = db.prepare(`SELECT c.created_at, c.customer_type, c.status FROM customers c WHERE ${sql}`).all(...params);
  const buckets = bucketize(rows, ctx.period, (r) => r.created_at);
  const data = buckets.map((b) => ({
    period: b.bucket,
    newCustomers: b.list.length,
    active: b.list.filter((r) => r.status === 'Active').length,
  }));
  return {
    columns: [
      { key: 'period', label: 'Period', format: 'text' },
      { key: 'newCustomers', label: 'New Customers', format: 'number' },
      { key: 'active', label: 'Active', format: 'number' },
    ],
    rows: data,
  };
}

function productsReport(db, ctx) {
  const { sql: oppSql, params: oppParams } = oppWhere(ctx, {});
  const won = db
    .prepare(`SELECT o.product_service, o.deal_value FROM opportunities o WHERE ${oppSql} AND o.stage = 'Won'`)
    .all(...oppParams);
  const open = db
    .prepare(`SELECT o.product_service, o.deal_value, o.probability FROM opportunities o WHERE ${oppSql} AND o.stage NOT IN ('Won','Lost')`)
    .all(...oppParams);
  const { sql: leadSql, params: leadParams } = leadWhere(ctx, {});
  const leads = db.prepare(`SELECT l.product_service FROM leads l WHERE ${leadSql}`).all(...leadParams);

  const map = new Map();
  const touch = (p) => {
    const key = p || 'Uncategorised';
    if (!map.has(key)) map.set(key, { product: key, sales: 0, openValue: 0, leads: 0 });
    return map.get(key);
  };
  for (const r of won) touch(r.product_service).sales += r.deal_value || 0;
  for (const r of open) touch(r.product_service).openValue += r.deal_value || 0;
  for (const r of leads) touch(r.product_service).leads += 1;

  const data = [...map.values()]
    .map((r) => ({ ...r, sales: r2(r.sales), openValue: r2(r.openValue) }))
    .sort((a, b) => b.sales - a.sales);
  return {
    columns: [
      { key: 'product', label: 'Product / Service', format: 'text' },
      { key: 'sales', label: 'Sales (Won)', format: 'currency' },
      { key: 'openValue', label: 'Open Pipeline', format: 'currency' },
      { key: 'leads', label: 'Leads', format: 'number' },
    ],
    rows: data,
  };
}

function territoriesReport(db, ctx) {
  const { sql: oppSql, params: oppParams } = oppWhere(ctx, {});
  const won = db
    .prepare(
      `SELECT u.territory, o.deal_value FROM opportunities o LEFT JOIN users u ON u.id = o.assigned_to WHERE ${oppSql} AND o.stage = 'Won'`
    )
    .all(...oppParams);
  const { sql: leadSql, params: leadParams } = leadWhere(ctx, {});
  const leads = db
    .prepare(`SELECT u.territory FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE ${leadSql}`)
    .all(...leadParams);
  const { sql: custSql, params: custParams } = customerWhere(ctx, {});
  const customers = db
    .prepare(`SELECT u.territory FROM customers c LEFT JOIN users u ON u.id = c.assigned_to WHERE ${custSql}`)
    .all(...custParams);

  const map = new Map();
  const touch = (t) => {
    const key = t || 'Unassigned';
    if (!map.has(key)) map.set(key, { territory: key, sales: 0, leads: 0, customers: 0 });
    return map.get(key);
  };
  for (const r of won) touch(r.territory).sales += r.deal_value || 0;
  for (const r of leads) touch(r.territory).leads += 1;
  for (const r of customers) touch(r.territory).customers += 1;

  const data = [...map.values()].map((r) => ({ ...r, sales: r2(r.sales) })).sort((a, b) => b.sales - a.sales);
  return {
    columns: [
      { key: 'territory', label: 'Territory', format: 'text' },
      { key: 'sales', label: 'Sales (Won)', format: 'currency' },
      { key: 'leads', label: 'Leads', format: 'number' },
      { key: 'customers', label: 'Customers', format: 'number' },
    ],
    rows: data,
  };
}

function collectionsReport(db, ctx) {
  const { sql, params } = paymentWhere(ctx, {});
  const rows = db
    .prepare(`SELECT p.payment_date, p.amount FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE ${sql}`)
    .all(...params);
  const buckets = bucketize(rows, ctx.period, (r) => r.payment_date);
  const data = buckets.map((b) => ({
    period: b.bucket,
    collected: r2(b.list.reduce((s, r) => s + (r.amount || 0), 0)),
    payments: b.list.length,
  }));
  return {
    columns: [
      { key: 'period', label: 'Period', format: 'text' },
      { key: 'collected', label: 'Collected', format: 'currency' },
      { key: 'payments', label: 'Payments', format: 'number' },
    ],
    rows: data,
  };
}

function agingReport(db, ctx) {
  const { sql, params } = invoiceWhere(ctx, { dateColumn: 'created_at' });
  const invoices = db.prepare(`SELECT i.id, i.amount, i.due_date FROM invoices i WHERE ${sql}`).all(...params);
  const buckets = [
    { bucket: 'Not due', amount: 0 },
    { bucket: '1-30 days', amount: 0 },
    { bucket: '31-60 days', amount: 0 },
    { bucket: '61-90 days', amount: 0 },
    { bucket: '90+ days', amount: 0 },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const paidById = invoicePaidByInvoiceIds(db, invoices.map((i) => i.id));
  for (const inv of invoices) {
    const balance = Math.round((inv.amount - (paidById.get(inv.id) ?? 0)) * 100) / 100;
    if (balance <= 0) continue;
    const key = !inv.due_date || inv.due_date >= today
      ? 'Not due'
      : daysBetween(inv.due_date, today) <= 30
        ? '1-30 days'
        : daysBetween(inv.due_date, today) <= 60
          ? '31-60 days'
          : daysBetween(inv.due_date, today) <= 90
            ? '61-90 days'
            : '90+ days';
    buckets.find((b) => b.bucket === key).amount += balance;
  }
  const data = buckets.map((b) => ({ bucket: b.bucket, outstanding: r2(b.amount) }));
  return {
    columns: [
      { key: 'bucket', label: 'Ageing Bucket', format: 'text' },
      { key: 'outstanding', label: 'Outstanding', format: 'currency' },
    ],
    rows: data,
  };
}

function daysBetween(from, to) {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function wonLostReport(db, ctx) {
  const { sql, params } = oppWhere(ctx, {});
  const rows = db
    .prepare(`SELECT o.stage, o.expected_close_date, o.deal_value FROM opportunities o WHERE ${sql} AND o.stage IN ('Won','Lost')`)
    .all(...params);
  const buckets = bucketize(rows, ctx.period, (r) => r.expected_close_date || '');
  const data = buckets.map((b) => ({
    period: b.bucket,
    won: b.list.filter((r) => r.stage === 'Won').length,
    lost: b.list.filter((r) => r.stage === 'Lost').length,
    wonValue: r2(b.list.filter((r) => r.stage === 'Won').reduce((s, r) => s + (r.deal_value || 0), 0)),
    lostValue: r2(b.list.filter((r) => r.stage === 'Lost').reduce((s, r) => s + (r.deal_value || 0), 0)),
  }));
  return {
    columns: [
      { key: 'period', label: 'Period', format: 'text' },
      { key: 'won', label: 'Won', format: 'number' },
      { key: 'lost', label: 'Lost', format: 'number' },
      { key: 'wonValue', label: 'Won Value', format: 'currency' },
      { key: 'lostValue', label: 'Lost Value', format: 'currency' },
    ],
    rows: data,
  };
}

function productivityReport(db, ctx) {
  const { sql: oppSql, params: oppParams } = oppWhere(ctx, {});
  const won = db
    .prepare(`SELECT o.assigned_to, o.deal_value FROM opportunities o WHERE ${oppSql} AND o.stage = 'Won'`)
    .all(...oppParams);
  const { sql: leadSql, params: leadParams } = leadWhere(ctx, {});
  const leads = db.prepare(`SELECT l.assigned_to FROM leads l WHERE ${leadSql}`).all(...leadParams);
  const { sql: custSql, params: custParams } = customerWhere(ctx, {});
  const customers = db.prepare(`SELECT c.assigned_to FROM customers c WHERE ${custSql}`).all(...custParams);
  const { sql: fuSql, params: fuParams } = followUpWhere(ctx, {});
  const fu = db.prepare(`SELECT f.assigned_to FROM follow_ups f WHERE ${fuSql} AND f.status = 'Completed'`).all(...fuParams);

  const users = db.prepare(`SELECT id, name, territory FROM users WHERE company_id = ? AND status = 'active'`).all(ctx.companyId);
  const byUser = new Map(users.map((u) => [u.id, { name: u.name, territory: u.territory || null, sales: 0, leads: 0, customers: 0, followUps: 0 }]));
  for (const r of won) if (byUser.has(r.assigned_to)) byUser.get(r.assigned_to).sales += r.deal_value || 0;
  for (const r of leads) if (byUser.has(r.assigned_to)) byUser.get(r.assigned_to).leads += 1;
  for (const r of customers) if (byUser.has(r.assigned_to)) byUser.get(r.assigned_to).customers += 1;
  for (const r of fu) if (byUser.has(r.assigned_to)) byUser.get(r.assigned_to).followUps += 1;

  const data = [...byUser.values()]
    .map((r) => ({ ...r, sales: r2(r.sales) }))
    .sort((a, b) => b.sales - a.sales);
  return {
    columns: [
      { key: 'name', label: 'Salesperson', format: 'text' },
      { key: 'territory', label: 'Territory', format: 'text' },
      { key: 'sales', label: 'Sales (Won)', format: 'currency' },
      { key: 'leads', label: 'Leads', format: 'number' },
      { key: 'customers', label: 'Customers', format: 'number' },
      { key: 'followUps', label: 'Follow-ups Completed', format: 'number' },
    ],
    rows: data,
  };
}

const REPORTERS = {
  sales: salesReport,
  'lead-conversion': leadConversionReport,
  'follow-ups': followUpsReport,
  pipeline: pipelineReport,
  'target-achievement': targetAchievementReport,
  customers: customersReport,
  products: productsReport,
  territories: territoriesReport,
  collections: collectionsReport,
  aging: agingReport,
  'won-lost': wonLostReport,
  productivity: productivityReport,
};

export function runReport(db, type, ctx) {
  const fn = REPORTERS[type];
  if (!fn) return null;
  return fn(db, ctx);
}
