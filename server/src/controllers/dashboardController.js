import { getDb } from '../db/connection.js';
import { ok } from '../lib/response.js';
import { badRequest } from '../lib/httpError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  getUserDataScope,
  buildLeadScopeWhere,
  buildCustomerScopeWhere,
  buildOpportunityScopeWhere,
  buildFollowUpScopeWhere,
  buildInvoiceScopeWhere,
  buildPaymentScopeWhere,
  buildTargetScopeWhere,
} from '../services/access.js';
import { computeActual } from '../services/targetService.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const OPEN_STAGES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation'];

function monthBuckets(count) {
  const buckets = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    buckets.push({ key, label, start: `${key}-01`, end: `${key}-31` });
  }
  return buckets;
}

function scopeWhere(buildFn, scope, alias, companyId) {
  const { where, params } = buildFn(scope, alias);
  if (scope.type === 'all') {
    return { where: `WHERE ${alias}.company_id = ?`, params: [companyId] };
  }
  return { where, params };
}

/**
 * Tenant dashboard summary. Real, tenant-scoped data shaped by the acting
 * user's role (via getUserDataScope). The companyId is always derived from the
 * authenticated session — never from client input — except for super admins,
 * who must explicitly pass a `companyId` to drill into a tenant.
 */
export const summary = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);

  let companyId;
  if (scope.type === 'all') {
    companyId = req.query.companyId ? Number(req.query.companyId) : null;
    if (!companyId) throw badRequest('A companyId query parameter is required');
  } else {
    companyId = req.user.companyId;
  }

  const buckets = monthBuckets(6);
  const currentMonth = buckets[buckets.length - 1];
  const today = new Date().toISOString().slice(0, 10);

  const leadW = scopeWhere(buildLeadScopeWhere, scope, 'l', companyId);
  const custW = scopeWhere(buildCustomerScopeWhere, scope, 'c', companyId);
  const oppW = scopeWhere(buildOpportunityScopeWhere, scope, 'o', companyId);
  const fupW = scopeWhere(buildFollowUpScopeWhere, scope, 'f', companyId);
  const invW = scopeWhere(buildInvoiceScopeWhere, scope, 'i', companyId);
  const payW = scopeWhere(buildPaymentScopeWhere, scope, 'p', companyId);
  const targetW = scopeWhere(buildTargetScopeWhere, scope, 't', companyId);

  const leads = db
    .prepare(`SELECT COUNT(*) AS c FROM leads l ${leadW.where} AND l.deleted_at IS NULL`)
    .get(...leadW.params).c;

  const customers = db
    .prepare(`SELECT COUNT(*) AS c FROM customers c ${custW.where} AND c.deleted_at IS NULL`)
    .get(...custW.params).c;

  const monthlySales = r2(
    db
      .prepare(
        `SELECT COALESCE(SUM(o.deal_value), 0) AS v FROM opportunities o ${oppW.where}
           AND o.deleted_at IS NULL AND o.stage = 'Won'
           AND date(o.expected_close_date) >= date(?) AND date(o.expected_close_date) <= date(?)`
      )
      .get(...oppW.params, currentMonth.start, currentMonth.end).v
  );

  const openPipeline = r2(
    db
      .prepare(
        `SELECT COALESCE(SUM(o.deal_value), 0) AS v FROM opportunities o ${oppW.where}
           AND o.deleted_at IS NULL AND o.stage NOT IN ('Won','Lost')`
      )
      .get(...oppW.params).v
  );

  const followUps = db
    .prepare(`SELECT COUNT(*) AS c FROM follow_ups f ${fupW.where} AND f.deleted_at IS NULL AND f.status = 'Pending'`)
    .get(...fupW.params).c;

  const overdueFollowUps = db
    .prepare(
      `SELECT COUNT(*) AS c FROM follow_ups f ${fupW.where} AND f.deleted_at IS NULL
         AND f.status = 'Pending' AND f.follow_up_date < ?`
    )
    .get(today, ...fupW.params).c;

  const invoiced = r2(
    db
      .prepare(`SELECT COALESCE(SUM(i.amount), 0) AS v FROM invoices i ${invW.where} AND i.deleted_at IS NULL`)
      .get(...invW.params).v
  );

  const outstanding = r2(
    db
      .prepare(
        `SELECT COALESCE(SUM(i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0)), 0) AS v
         FROM invoices i ${invW.where} AND i.deleted_at IS NULL`
      )
      .get(...invW.params).v
  );

  const collectedThisMonth = r2(
    db
      .prepare(
        `SELECT COALESCE(SUM(p.amount), 0) AS v
         FROM payments p JOIN invoices i ON i.id = p.invoice_id ${payW.where} AND p.deleted_at IS NULL
           AND date(p.payment_date) >= date(?) AND date(p.payment_date) <= date(?)`
      )
      .get(...payW.params, currentMonth.start, currentMonth.end).v
  );

  const paymentsThisMonth = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM payments p JOIN invoices i ON i.id = p.invoice_id ${payW.where} AND p.deleted_at IS NULL
         AND date(p.payment_date) >= date(?) AND date(p.payment_date) <= date(?)`
    )
    .get(...payW.params, currentMonth.start, currentMonth.end).c;

  // Target achievement: active sales targets covering today.
  const activeTargets = db
    .prepare(
      `SELECT * FROM targets t ${targetW.where} AND t.deleted_at IS NULL
         AND t.status = 'Active' AND t.target_type = 'sales'
         AND date(t.start_date) <= date(?) AND date(t.end_date) >= date(?)`
    )
    .all(...targetW.params, today, today);

  let targetValue = 0;
  let targetAchieved = 0;
  for (const t of activeTargets) {
    targetValue += Number(t.target_value) || 0;
    targetAchieved += computeActual(db, t);
  }
  targetValue = r2(targetValue);
  targetAchieved = r2(targetAchieved);
  const targetAchievementPct = targetValue > 0 ? r2((targetAchieved / targetValue) * 100) : 0;

  // Charts.
  const monthlySalesMap = new Map();
  const salesByMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', o.expected_close_date) AS m, COALESCE(SUM(o.deal_value), 0) AS v
       FROM opportunities o ${oppW.where} AND o.deleted_at IS NULL AND o.stage = 'Won'
       GROUP BY m`
    )
    .all(...oppW.params);
  for (const r of salesByMonth) monthlySalesMap.set(r.m, r.v);

  const allSalesTargets = db
    .prepare(
      `SELECT * FROM targets t ${targetW.where} AND t.deleted_at IS NULL
         AND t.status = 'Active' AND t.target_type = 'sales' AND t.period_type = 'monthly'`
    )
    .all(...targetW.params);

  const salesTrendValues = buckets.map((b) => r2(monthlySalesMap.get(b.key) || 0));
  const targetTrendValues = buckets.map((b) => {
    let sum = 0;
    for (const t of allSalesTargets) {
      if (t.start_date <= b.end && t.end_date >= b.start) sum += Number(t.target_value) || 0;
    }
    return r2(sum);
  });

  const pipelineStageValues = db
    .prepare(
      `SELECT o.stage, COALESCE(SUM(o.deal_value), 0) AS v
       FROM opportunities o ${oppW.where} AND o.deleted_at IS NULL AND o.stage IN (${OPEN_STAGES.map(() => '?').join(', ')})
       GROUP BY o.stage`
    )
    .all(...oppW.params, ...OPEN_STAGES);
  const pipelineByStage = new Map(pipelineStageValues.map((r) => [r.stage, r.v]));

  const leadFunnel = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN l.status NOT IN ('Won','Lost') THEN 1 ELSE 0 END), 0) AS open_count,
         COALESCE(SUM(CASE WHEN l.status = 'Won' THEN 1 ELSE 0 END), 0) AS won,
         COALESCE(SUM(CASE WHEN l.status = 'Lost' THEN 1 ELSE 0 END), 0) AS lost
       FROM leads l ${leadW.where} AND l.deleted_at IS NULL`
    )
    .get(...leadW.params);

  const role = req.user.roleKey;

  const kpis = buildKpis(role, {
    leads,
    customers,
    monthlySales,
    targetAchievementPct,
    targetAchieved,
    targetValue,
    followUps,
    overdueFollowUps,
    openPipeline,
    outstanding,
    invoiced,
    collectedThisMonth,
    paymentsThisMonth,
  });

  const company = db.prepare('SELECT id, name FROM companies WHERE id = ?').get(companyId);

  return ok(res, {
    role,
    companyId,
    company: company ? { id: company.id, name: company.name } : null,
    kpis,
    charts: {
      salesTrend: {
        title: 'Sales Trend',
        labels: buckets.map((b) => b.label),
        series: [{ name: 'Sales', values: salesTrendValues }],
      },
      targetVsAchievement: {
        title: 'Target vs Achievement',
        labels: buckets.map((b) => b.label),
        series: [
          { name: 'Achieved', values: salesTrendValues },
          { name: 'Target', values: targetTrendValues },
        ],
      },
      pipeline: {
        title: 'Pipeline by Stage',
        labels: OPEN_STAGES,
        series: [{ name: 'Value', values: OPEN_STAGES.map((s) => r2(pipelineByStage.get(s) || 0)) }],
      },
      leadConversion: {
        title: 'Lead Conversion',
        labels: ['Open', 'Won', 'Lost'],
        series: [{ name: 'Leads', values: [leadFunnel.open_count, leadFunnel.won, leadFunnel.lost] }],
      },
    },
  });
});

function kpi(key, label, value, format, hint) {
  return { key, label, value, format, hint };
}

function buildKpis(role, m) {
  switch (role) {
    case 'sales_executive':
      return [
        kpi('leads', 'My Leads', m.leads, 'number', 'Assigned to me'),
        kpi('customers', 'My Customers', m.customers, 'number', 'Assigned to me'),
        kpi('monthlySales', 'My Sales', m.monthlySales, 'currency', 'Won this month'),
        kpi('targetAchievement', 'Target Achievement', m.targetAchievementPct, 'percent', 'Vs. my target'),
        kpi('followUps', 'My Follow-ups', m.followUps, 'number', 'Pending'),
        kpi('openPipeline', 'Open Pipeline', m.openPipeline, 'currency', 'My open deals'),
      ];
    case 'accountant':
      return [
        kpi('invoiced', 'Invoiced', m.invoiced, 'currency', 'Total invoices'),
        kpi('collected', 'Collected', m.collectedThisMonth, 'currency', 'This month'),
        kpi('outstanding', 'Outstanding', m.outstanding, 'currency', 'Unpaid balance'),
        kpi('payments', 'Payments', m.paymentsThisMonth, 'number', 'This month'),
      ];
    case 'sales_manager':
    case 'team_leader':
      return [
        kpi('leads', 'Team Leads', m.leads, 'number', 'Across your team(s)'),
        kpi('customers', 'Team Customers', m.customers, 'number', 'Across your team(s)'),
        kpi('monthlySales', 'Team Sales', m.monthlySales, 'currency', 'Won this month'),
        kpi('targetAchievement', 'Target Achievement', m.targetAchievementPct, 'percent', 'Vs. sales target'),
        kpi('followUps', 'Follow-ups', m.followUps, 'number', 'Pending'),
        kpi('outstanding', 'Outstanding', m.outstanding, 'currency', 'Unpaid collections'),
      ];
    default:
      // business_owner, viewer, and any other company-scoped role.
      return [
        kpi('leads', 'Leads', m.leads, 'number', 'Total leads'),
        kpi('customers', 'Customers', m.customers, 'number', 'Active customers'),
        kpi('monthlySales', 'Monthly Sales', m.monthlySales, 'currency', 'This month'),
        kpi('targetAchievement', 'Target Achievement', m.targetAchievementPct, 'percent', 'Vs. monthly target'),
        kpi('followUps', 'Follow-ups', m.followUps, 'number', 'Pending'),
        kpi('outstanding', 'Outstanding', m.outstanding, 'currency', 'Unpaid collections'),
      ];
  }
}
