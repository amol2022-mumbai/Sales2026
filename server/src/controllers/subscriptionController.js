import { getDb } from '../db/connection.js';
import { notFound } from '../lib/httpError.js';
import { ok, created } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveLicense, getUserCount } from '../services/licenseService.js';
import {
  subscriptionInvoiceNo,
  subscriptionPaymentNo,
  subscriptionInvoiceBalance,
  subscriptionInvoicePaid,
  recomputeSubscriptionInvoiceStatus,
  isSubscriptionOverdue,
} from '../services/subscriptionService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const SUB_INVOICE_SELECT = `
  SELECT si.*, c.name AS company_name, p.name AS plan_name, p.key AS plan_key
  FROM subscription_invoices si
  JOIN companies c ON c.id = si.company_id
  LEFT JOIN plans p ON p.id = si.plan_id
`;

const SUB_PAYMENT_SELECT = `
  SELECT sp.*, c.name AS company_name, si.invoice_no AS invoice_no
  FROM subscription_payments sp
  JOIN subscription_invoices si ON si.id = sp.invoice_id
  JOIN companies c ON c.id = sp.company_id
`;

function subscriptionInvoiceToJson(db, row) {
  const balance = subscriptionInvoiceBalance(db, row);
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    companyId: row.company_id,
    companyName: row.company_name || null,
    planId: row.plan_id,
    planKey: row.plan_key || null,
    planName: row.plan_name || null,
    amount: row.amount,
    description: row.description,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    dueDate: row.due_date,
    paid: round2(subscriptionInvoicePaid(db, row.id)),
    balance,
    status: row.status,
    overdue: isSubscriptionOverdue(row, balance),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subscriptionPaymentToJson(row) {
  return {
    id: row.id,
    paymentNo: row.payment_no,
    invoiceId: row.invoice_id,
    invoiceNo: row.invoice_no,
    companyId: row.company_id,
    companyName: row.company_name || null,
    amount: row.amount,
    paymentDate: row.payment_date,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/**
 * Billing summary for a single company's subscription: license + plan +
 * derived amounts from real subscription invoice/payment records.
 */
function subscriptionToJson(db, company) {
  const license = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(company.id);
  const plan = license?.plan_id ? db.prepare('SELECT * FROM plans WHERE id = ?').get(license.plan_id) || null : null;
  const { status, expiresAt, startsAt, userLimit } = resolveLicense(db, company.id);
  const userCount = getUserCount(db, company.id);

  const billed = round2(
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM subscription_invoices WHERE company_id = ? AND status != 'Void'").get(company.id).v
  );
  const paid = round2(
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM subscription_payments WHERE company_id = ? AND deleted_at IS NULL').get(company.id).v
  );
  const outstanding = Math.max(0, round2(billed - paid));
  const openInvoices = db
    .prepare("SELECT COUNT(*) AS c FROM subscription_invoices WHERE company_id = ? AND status IN ('Unpaid','Partial')")
    .get(company.id).c;

  return {
    companyId: company.id,
    name: company.name,
    domain: company.domain || null,
    companyStatus: company.status,
    licenseStatus: status,
    planKey: plan?.key || null,
    planName: plan?.name || null,
    planPriceMonthly: plan?.price_monthly ?? 0,
    startsAt: startsAt || null,
    expiresAt: expiresAt || null,
    userLimit,
    userCount,
    billed,
    paid,
    outstanding,
    openInvoices,
  };
}

// ---------------------------------------------------------------------------
// Subscriptions (Super Admin only — mounted under /api/admin).
// ---------------------------------------------------------------------------
export const listSubscriptions = asyncHandler(async (_req, res) => {
  const db = getDb();
  const companies = db.prepare('SELECT * FROM companies ORDER BY id').all();
  return ok(res, companies.map((c) => subscriptionToJson(db, c)));
});

export const getSubscription = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.companyId);
  if (!company) throw notFound('Client not found');

  const invoices = db
    .prepare(`${SUB_INVOICE_SELECT} WHERE si.company_id = ? ORDER BY si.id DESC`)
    .all(company.id)
    .map((row) => subscriptionInvoiceToJson(db, row));

  return ok(res, { ...subscriptionToJson(db, company), invoices });
});

export const createSubscriptionInvoice = asyncHandler(async (req, res) => {
  const db = getDb();
  const companyId = Number(req.params.companyId);
  const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!company) throw notFound('Client not found');

  if (req.body.planId != null) {
    const plan = db.prepare('SELECT id FROM plans WHERE id = ?').get(req.body.planId);
    if (!plan) throw notFound('Plan not found');
  }

  const result = db
    .prepare(
      `INSERT INTO subscription_invoices (company_id, plan_id, amount, description, period_start, period_end, due_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Unpaid', ?)`
    )
    .run(
      companyId,
      req.body.planId ?? null,
      req.body.amount,
      req.body.description ?? null,
      req.body.periodStart ?? null,
      req.body.periodEnd ?? null,
      req.body.dueDate ?? null,
      req.user.id
    );

  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE subscription_invoices SET invoice_no = ? WHERE id = ?').run(subscriptionInvoiceNo(id), id);

  req.audit?.('subscription.invoice.create', { entityType: 'subscription_invoice', entityId: id, metadata: { companyId, amount: req.body.amount } });

  const row = db.prepare(`${SUB_INVOICE_SELECT} WHERE si.id = ?`).get(id);
  return created(res, subscriptionInvoiceToJson(db, row));
});

export const recordSubscriptionPayment = asyncHandler(async (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM subscription_invoices WHERE id = ?').get(req.params.id);
  if (!invoice) throw notFound('Subscription invoice not found');

  const result = db
    .prepare(
      `INSERT INTO subscription_payments (company_id, invoice_id, amount, payment_date, method, reference, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      invoice.company_id,
      invoice.id,
      req.body.amount,
      req.body.paymentDate,
      req.body.method ?? 'Bank Transfer',
      req.body.reference ?? null,
      req.body.notes ?? null,
      req.user.id
    );

  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE subscription_payments SET payment_no = ? WHERE id = ?').run(subscriptionPaymentNo(id), id);
  recomputeSubscriptionInvoiceStatus(db, invoice.id);

  req.audit?.('subscription.payment.create', { entityType: 'subscription_payment', entityId: id, metadata: { invoiceId: invoice.id, amount: req.body.amount } });

  const row = db.prepare(`${SUB_PAYMENT_SELECT} WHERE sp.id = ?`).get(id);
  return created(res, subscriptionPaymentToJson(row));
});
