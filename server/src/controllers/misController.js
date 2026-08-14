import { getDb } from '../db/connection.js';
import { badRequest } from '../lib/httpError.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  getUserDataScope,
  buildLeadScopeWhere,
  buildCustomerScopeWhere,
  buildOpportunityScopeWhere,
  buildFollowUpScopeWhere,
  buildInvoiceScopeWhere,
  buildPaymentScopeWhere,
} from '../services/access.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function scopeWhere(buildFn, scope, alias, companyId) {
  const { where, params } = buildFn(scope, alias);
  if (scope.type === 'all') {
    return { where: `WHERE ${alias}.company_id = ?`, params: [companyId] };
  }
  return { where, params };
}

/**
 * Management Information System summary. Every metric is computed from real,
 * tenant-scoped source data. Super admins must supply a companyId; all other
 * roles are restricted to their own company and (via the scope builders) their
 * own team/self visibility.
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

  const from = req.query.from || '0000-01-01';
  const to = req.query.to || '9999-12-31';
  const today = new Date().toISOString().slice(0, 10);

  const leadW = scopeWhere(buildLeadScopeWhere, scope, 'l', companyId);
  const custW = scopeWhere(buildCustomerScopeWhere, scope, 'c', companyId);
  const oppW = scopeWhere(buildOpportunityScopeWhere, scope, 'o', companyId);
  const fupW = scopeWhere(buildFollowUpScopeWhere, scope, 'f', companyId);
  const invW = scopeWhere(buildInvoiceScopeWhere, scope, 'i', companyId);
  const payW = scopeWhere(buildPaymentScopeWhere, scope, 'p', companyId);

  const totalLeads = db
    .prepare(`SELECT COUNT(*) AS c FROM leads l ${leadW.where} AND l.deleted_at IS NULL`)
    .get(...leadW.params).c;
  const newLeads = db
    .prepare(
      `SELECT COUNT(*) AS c FROM leads l ${leadW.where} AND l.deleted_at IS NULL
         AND date(l.created_at) >= date(?) AND date(l.created_at) <= date(?)`
    )
    .get(...leadW.params, from, to).c;

  const totalCustomers = db
    .prepare(`SELECT COUNT(*) AS c FROM customers c ${custW.where} AND c.deleted_at IS NULL`)
    .get(...custW.params).c;
  const newCustomers = db
    .prepare(
      `SELECT COUNT(*) AS c FROM customers c ${custW.where} AND c.deleted_at IS NULL
         AND date(c.created_at) >= date(?) AND date(c.created_at) <= date(?)`
    )
    .get(...custW.params, from, to).c;

  const pipeline = db
    .prepare(
      `SELECT COUNT(*) AS open_count,
              COALESCE(SUM(o.deal_value), 0) AS open_value,
              COALESCE(SUM(o.deal_value * o.probability / 100.0), 0) AS weighted_value
       FROM opportunities o ${oppW.where} AND o.deleted_at IS NULL AND o.stage NOT IN ('Won','Lost')`
    )
    .get(...oppW.params);

  const sales = db
    .prepare(
      `SELECT COUNT(*) AS won_count, COALESCE(SUM(o.deal_value), 0) AS won_value
       FROM opportunities o ${oppW.where} AND o.deleted_at IS NULL AND o.stage = 'Won'
         AND date(o.expected_close_date) >= date(?) AND date(o.expected_close_date) <= date(?)`
    )
    .get(...oppW.params, from, to);

  const closed = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN o.stage = 'Won' THEN 1 ELSE 0 END), 0) AS won,
              COALESCE(SUM(CASE WHEN o.stage IN ('Won','Lost') THEN 1 ELSE 0 END), 0) AS closed
       FROM opportunities o ${oppW.where} AND o.deleted_at IS NULL AND o.stage IN ('Won','Lost')
         AND date(o.expected_close_date) >= date(?) AND date(o.expected_close_date) <= date(?)`
    )
    .get(...oppW.params, from, to);

  const followUps = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN f.status = 'Pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN f.status = 'Completed' THEN 1 ELSE 0 END), 0) AS completed,
              COALESCE(SUM(CASE WHEN f.status = 'Pending' AND f.follow_up_date < ? THEN 1 ELSE 0 END), 0) AS overdue
       FROM follow_ups f ${fupW.where} AND f.deleted_at IS NULL`
    )
    .get(today, ...fupW.params);

  const invoiced = db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(i.amount), 0) AS amount FROM invoices i ${invW.where} AND i.deleted_at IS NULL`)
    .get(...invW.params);

  const outstanding = db
    .prepare(
      `SELECT COALESCE(SUM(i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0)), 0) AS v
       FROM invoices i ${invW.where} AND i.deleted_at IS NULL`
    )
    .get(...invW.params);

  const collected = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS v
       FROM payments p JOIN invoices i ON i.id = p.invoice_id ${payW.where} AND p.deleted_at IS NULL
         AND date(p.payment_date) >= date(?) AND date(p.payment_date) <= date(?)`
    )
    .get(...payW.params, from, to);

  const wonCount = sales.won_count || 0;
  const closedCount = closed.closed || 0;
  const conversionRate = closedCount > 0 ? r2((closed.won / closedCount) * 100) : 0;

  return ok(res, {
    period: { from, to },
    leads: { total: totalLeads, newInPeriod: newLeads },
    customers: { total: totalCustomers, newInPeriod: newCustomers },
    pipeline: {
      openCount: pipeline.open_count || 0,
      openValue: r2(pipeline.open_value),
      weightedValue: r2(pipeline.weighted_value),
    },
    sales: { wonCount, wonValue: r2(sales.won_value), conversionRate },
    followUps: {
      pending: followUps.pending || 0,
      completed: followUps.completed || 0,
      overdue: followUps.overdue || 0,
    },
    collections: {
      invoiceCount: invoiced.count || 0,
      invoiced: r2(invoiced.amount),
      collected: r2(collected.v),
      outstanding: r2(outstanding.v),
    },
  });
});
