// ============================================================================
// Billing service (Phase 14). Owns the online-payment + subscription lifecycle:
// checkout invoices, verified payment application (idempotent), refunds,
// cancellation, plan changes and renewals. Every lifecycle mutation that
// originates from a payment provider flows through `processWebhookEvent`, which
// records the event idempotently before applying any change. The frontend is
// never trusted with payment state.
// ============================================================================

import { getDb } from '../db/connection.js';
import { HttpError, badRequest, notFound } from '../lib/httpError.js';
import { resolveLicense, getUserCount } from './licenseService.js';
import {
  subscriptionInvoiceNo,
  subscriptionPaymentNo,
  subscriptionInvoiceBalance,
  subscriptionInvoicePaid,
  subscriptionCompanyPaid,
  subscriptionCompanyBilled,
  recomputeSubscriptionInvoiceStatus,
} from './subscriptionService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cycleDays(cycle) {
  return cycle === 'annual' ? 365 : 30;
}

/**
 * Price for a plan in the given billing cycle. Annual falls back to monthly
 * when no annual price is configured.
 */
export function planPrice(plan, cycle) {
  if (!plan) return 0;
  if (cycle === 'annual' && Number(plan.price_annual) > 0) return Number(plan.price_annual);
  return Number(plan.price_monthly) || 0;
}

function parseModules(value) {
  if (value == null) return null;
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function planToSummary(p) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    userLimit: p.user_limit,
    modules: parseModules(p.modules),
    priceMonthly: Number(p.price_monthly) || 0,
    priceAnnual: Number(p.price_annual) || 0,
    storageLimitMb: p.storage_limit_mb,
    exportEnabled: Boolean(p.export_enabled),
    apiEnabled: Boolean(p.api_enabled),
    trialDays: p.trial_days,
  };
}

function getLicense(db, companyId) {
  return db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId) || null;
}

/**
 * Ensure a license row exists for a company (created with plan inheritance).
 */
function ensureLicense(db, companyId, planId) {
  let license = getLicense(db, companyId);
  if (license) return license;
  db.prepare(
    `INSERT INTO licenses (company_id, plan_id, status, auto_renew)
     VALUES (?, ?, 'active', 1)`
  ).run(companyId, planId ?? null);
  return getLicense(db, companyId);
}

/**
 * Extend a license's expiry after a verified payment for the given cycle.
 * Active/trial licenses with a future expiry are extended from that expiry;
 * otherwise the term starts today. The license is activated and its billing
 * cycle and auto-renew flag are recorded.
 */
function extendLicense(db, companyId, { planId, cycle, autoRenew = 1 }) {
  const days = cycleDays(cycle);
  const now = today();
  let license = ensureLicense(db, companyId, planId);

  let newExpiry;
  if ((license.status === 'active' || license.status === 'trial') && license.expires_at && license.expires_at >= now) {
    newExpiry = addDays(license.expires_at, days);
  } else {
    newExpiry = addDays(now, days);
  }

  db.prepare(
    `UPDATE licenses
     SET plan_id = COALESCE(?, plan_id), status = 'active', past_due_at = NULL, billing_cycle = ?, auto_renew = ?,
         starts_at = COALESCE(starts_at, ?), expires_at = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(planId ?? license.plan_id, cycle, autoRenew, now, newExpiry, license.id);

  return getLicense(db, companyId);
}

/**
 * Create a subscription invoice for a plan + billing cycle. Returns the invoice
 * row (with derived amounts handled by callers).
 */
export function createSubscriptionInvoice(db, { companyId, planId, cycle, amount, description, actorUserId }) {
  const periodStart = today();
  const periodEnd = addDays(periodStart, cycleDays(cycle));
  const result = db
    .prepare(
      `INSERT INTO subscription_invoices (company_id, plan_id, amount, description, period_start, period_end, due_date, status, billing_cycle, provider, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Unpaid', ?, ?, ?)`
    )
    .run(companyId, planId ?? null, round2(amount), description ?? null, periodStart, periodEnd, periodStart, cycle, null, actorUserId ?? null);

  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE subscription_invoices SET invoice_no = ? WHERE id = ?').run(subscriptionInvoiceNo(id), id);
  return db.prepare('SELECT * FROM subscription_invoices WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
// Verified payment application (idempotent).
// ---------------------------------------------------------------------------

/**
 * Apply a provider-verified payment to a subscription invoice. Idempotent via
 * the provider payment id: a duplicate event is a no-op. Extends and activates
 * the license.
 */
export function applyVerifiedPayment(db, { invoiceId, providerId, provider, amountPaid, method = 'Card' }) {
  const invoice = db.prepare('SELECT * FROM subscription_invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw notFound('Subscription invoice not found');

  const existing = providerId
    ? db.prepare("SELECT id FROM subscription_payments WHERE provider_id = ? AND type = 'payment'").get(providerId)
    : null;
  if (existing) return { duplicate: true, invoiceId };

  const amount = round2(amountPaid ?? invoice.amount);
  const result = db
    .prepare(
      `INSERT INTO subscription_payments (company_id, invoice_id, amount, payment_date, method, type, provider, provider_id)
       VALUES (?, ?, ?, ?, ?, 'payment', ?, ?)`
    )
    .run(invoice.company_id, invoice.id, amount, today(), method, provider ?? null, providerId ?? null);

  const paymentId = Number(result.lastInsertRowid);
  db.prepare('UPDATE subscription_payments SET payment_no = ? WHERE id = ?').run(subscriptionPaymentNo(paymentId), paymentId);
  recomputeSubscriptionInvoiceStatus(db, invoice.id);

  const cycle = invoice.billing_cycle || 'monthly';
  extendLicense(db, invoice.company_id, { planId: invoice.plan_id, cycle });

  return { duplicate: false, invoiceId, paymentId, amount };
}

/**
 * Record a provider-verified refund against an invoice (idempotent). Reduces
 * the invoice's paid balance; the license is left for the operator to manage.
 */
export function applyRefund(db, { invoiceId, providerId, provider, amount, method = 'Refund' }) {
  const invoice = db.prepare('SELECT * FROM subscription_invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw notFound('Subscription invoice not found');

  const existing = providerId
    ? db.prepare("SELECT id FROM subscription_payments WHERE provider_id = ? AND type = 'refund'").get(providerId)
    : null;
  if (existing) return { duplicate: true, invoiceId };

  const result = db
    .prepare(
      `INSERT INTO subscription_payments (company_id, invoice_id, amount, payment_date, method, type, provider, provider_id)
       VALUES (?, ?, ?, ?, ?, 'refund', ?, ?)`
    )
    .run(invoice.company_id, invoice.id, round2(amount), today(), method, provider ?? null, providerId ?? null);

  const paymentId = Number(result.lastInsertRowid);
  db.prepare('UPDATE subscription_payments SET payment_no = ? WHERE id = ?').run(subscriptionPaymentNo(paymentId), paymentId);
  recomputeSubscriptionInvoiceStatus(db, invoice.id);

  return { duplicate: false, invoiceId, paymentId, amount };
}

// ---------------------------------------------------------------------------
// Lifecycle actions (shared by super admin and company billing).
// ---------------------------------------------------------------------------

/**
 * Change a company's plan. `applyImmediately` (super admin) applies the plan
 * without a payment; otherwise a checkout invoice is created for the new plan.
 */
export function changePlan(db, { companyId, planId, cycle = 'monthly', actorUserId, applyImmediately = false }) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) throw notFound('Client not found');
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
  if (!plan) throw notFound('Plan not found');

  const price = planPrice(plan, cycle);

  if (applyImmediately || price === 0) {
    ensureLicense(db, companyId, planId);
    db.prepare(
      `UPDATE licenses SET plan_id = ?, status = 'active', past_due_at = NULL, billing_cycle = ?, auto_renew = 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE company_id = ?`
    ).run(planId, cycle, companyId);
    return { appliedImmediately: true, invoice: null, price };
  }

  const invoice = createSubscriptionInvoice(db, {
    companyId,
    planId,
    cycle,
    amount: price,
    description: `${plan.name} — ${cycle === 'annual' ? 'Annual' : 'Monthly'} subscription`,
    actorUserId,
  });

  return { appliedImmediately: false, invoice, price };
}

/**
 * Renew a company's current subscription: extends the term on payment, or
 * immediately for a free plan.
 */
export function renewSubscription(db, { companyId, cycle, actorUserId }) {
  const license = getLicense(db, companyId);
  if (!license || !license.plan_id) throw badRequest('No active plan to renew');
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(license.plan_id);
  if (!plan) throw notFound('Plan not found');

  const effectiveCycle = cycle || license.billing_cycle || 'monthly';
  const price = planPrice(plan, effectiveCycle);

  if (price === 0) {
    extendLicense(db, companyId, { planId: plan.id, cycle: effectiveCycle });
    return { appliedImmediately: true, invoice: null, price };
  }

  const invoice = createSubscriptionInvoice(db, {
    companyId,
    planId: plan.id,
    cycle: effectiveCycle,
    amount: price,
    description: `${plan.name} — renewal (${effectiveCycle})`,
    actorUserId,
  });
  return { appliedImmediately: false, invoice, price };
}

/**
 * Cancel a company's subscription (immediate): license marked cancelled and
 * auto-renew disabled.
 */
export function cancelSubscription(db, { companyId, actorUserId }) {
  const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!company) throw notFound('Client not found');
  ensureLicense(db, companyId, null);
  db.prepare(
    `UPDATE licenses SET status = 'cancelled', auto_renew = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE company_id = ?`
  ).run(companyId);
  return getLicense(db, companyId);
}

/**
 * Reactivate a cancelled subscription, restoring auto-renew and a future
 * expiry when none remains.
 */
export function reactivateSubscription(db, { companyId, actorUserId }) {
  const license = getLicense(db, companyId);
  if (!license) throw notFound('No license to reactivate');

  const cycle = license.billing_cycle || 'monthly';
  let expiresAt = license.expires_at;
  if (!expiresAt || expiresAt < today()) {
    expiresAt = addDays(today(), cycleDays(cycle));
  }

  db.prepare(
    `UPDATE licenses SET status = 'active', past_due_at = NULL, auto_renew = 1, expires_at = ?, billing_cycle = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(expiresAt, cycle, license.id);
  return getLicense(db, companyId);
}

/**
 * Record an operator-initiated refund against a subscription invoice.
 */
export function refundSubscription(db, { invoiceId, amount, actorUserId, provider = null, providerId = null }) {
  return applyRefund(db, { invoiceId, providerId, provider, amount, method: 'Refund' });
}

/**
 * Move a subscription into `past_due` after a failed payment. The company is
 * resolved authoritatively from the invoice (or the supplied companyId). Only
 * active/trial/past_due licenses are downgraded; suspended/cancelled/expired
 * licenses are left untouched. Records when the account entered `past_due` so
 * the grace period can be evaluated.
 */
export function markSubscriptionPastDue(db, { invoiceId = null, companyId = null }) {
  let targetCompanyId = companyId;
  if (invoiceId != null) {
    const invoice = db.prepare('SELECT company_id FROM subscription_invoices WHERE id = ?').get(invoiceId);
    if (invoice) targetCompanyId = invoice.company_id;
  }
  if (!targetCompanyId) return null;

  const now = today();
  const license = getLicense(db, targetCompanyId);
  if (!license) return null;
  if (!['active', 'trial', 'past_due'].includes(license.status)) return license;

  db.prepare(
    `UPDATE licenses SET status = 'past_due', past_due_at = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(now, license.id);
  return getLicense(db, targetCompanyId);
}

/**
 * Suspend a subscription at the license level (immediate). Blocks tenant access
 * until reactivated. Used by the Super Admin as an explicit `past_due ->
 * suspended` (or abuse) control.
 */
export function suspendSubscription(db, { companyId, actorUserId }) {
  const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!company) throw notFound('Client not found');
  const license = ensureLicense(db, companyId, null);
  db.prepare(
    `UPDATE licenses SET status = 'suspended',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(license.id);
  return getLicense(db, companyId);
}

// ---------------------------------------------------------------------------
// Webhook events (idempotent record + dispatch).
// ---------------------------------------------------------------------------

function recordWebhookEvent(db, { provider, providerEventId, eventType, companyId = null, invoiceId = null, payload = null }) {
  try {
    const result = db
      .prepare(
        `INSERT INTO subscription_events (provider, provider_event_id, event_type, company_id, invoice_id, status, payload)
         VALUES (?, ?, ?, ?, ?, 'received', ?)`
      )
      .run(provider, providerEventId, eventType, companyId, invoiceId, payload ? JSON.stringify(payload) : null);
    return { id: Number(result.lastInsertRowid), duplicate: false };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = db
        .prepare('SELECT id FROM subscription_events WHERE provider = ? AND provider_event_id = ?')
        .get(provider, providerEventId);
      if (existing) {
        db.prepare("UPDATE subscription_events SET status = 'duplicate' WHERE id = ?").run(existing.id);
      }
      return { id: existing?.id ?? null, duplicate: true };
    }
    throw err;
  }
}

function markEvent(db, id, status) {
  db.prepare(
    `UPDATE subscription_events SET status = ?, processed_at = CASE WHEN ? = 'processed' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE processed_at END WHERE id = ?`
  ).run(status, status, id);
}

/**
 * Process a verified webhook event: record idempotently then dispatch to the
 * matching lifecycle handler. Returns a summary used by the webhook endpoint.
 */
export function processWebhookEvent(db, event) {
  const provider = event.provider || 'stripe';
  const providerEventId = event.id;
  const eventType = event.type;
  if (!providerEventId || !eventType) throw badRequest('Invalid webhook event');

  const object = event.data?.object || event.data || {};
  const companyId = object.company_id ?? object.companyId ?? null;
  const invoiceId = object.invoice_id ?? object.invoiceId ?? object.subscription_invoice_id ?? null;

  const recorded = recordWebhookEvent(db, {
    provider,
    providerEventId,
    eventType,
    companyId: companyId ? Number(companyId) : null,
    invoiceId: invoiceId ? Number(invoiceId) : null,
    payload: event,
  });

  if (recorded.duplicate) return { duplicate: true, eventId: recorded.id, eventType };

  let result = { applied: false, eventType };
  try {
    switch (eventType) {
      case 'invoice.paid':
      case 'payment_intent.succeeded':
      case 'invoice.payment_succeeded':
        if (!invoiceId) throw badRequest('Payment event missing invoice id');
        result = { ...applyVerifiedPayment(db, {
          invoiceId: Number(invoiceId),
          providerId: object.payment_intent ?? object.paymentId ?? `evt_${providerEventId}`,
          provider,
          amountPaid: object.amount_paid ?? object.amountPaid ?? null,
          method: object.method || 'Card',
        }), applied: true, eventType };
        break;
      case 'invoice.payment_failed':
      case 'payment_intent.payment_failed':
        markSubscriptionPastDue(db, {
          invoiceId: invoiceId ? Number(invoiceId) : null,
          companyId: companyId ? Number(companyId) : null,
        });
        result = { applied: true, eventType, failed: true };
        break;
      case 'charge.refunded':
      case 'refund.updated':
      case 'refund.succeeded':
        if (invoiceId) {
          result = { ...applyRefund(db, {
            invoiceId: Number(invoiceId),
            providerId: object.refund_id ?? object.refundId ?? `evt_${providerEventId}`,
            provider,
            amount: object.amount_refunded ?? object.amountRefunded ?? object.amount ?? 0,
          }), applied: true, eventType };
        } else {
          result = { applied: true, eventType };
        }
        break;
      case 'customer.subscription.deleted':
      case 'subscription.cancelled':
        if (companyId) {
          cancelSubscription(db, { companyId: Number(companyId) });
          result = { applied: true, eventType };
        } else {
          result = { applied: true, eventType };
        }
        break;
      default:
        result = { applied: false, eventType };
    }
    markEvent(db, recorded.id, 'processed');
  } catch (err) {
    markEvent(db, recorded.id, 'failed');
    throw err;
  }

  return { duplicate: false, eventId: recorded.id, eventType, ...result };
}

// ---------------------------------------------------------------------------
// Billing summary.
// ---------------------------------------------------------------------------

/**
 * Full billing summary for a single company (used by the company billing page
 * and the super-admin subscription detail).
 */
export function getCompanyBillingSummary(db, company) {
  const license = getLicense(db, company.id);
  const plan = license?.plan_id ? db.prepare('SELECT * FROM plans WHERE id = ?').get(license.plan_id) || null : null;
  const { status, expiresAt, startsAt, userLimit, moduleKeys, storageLimitMb, exportEnabled, apiEnabled } = resolveLicense(
    db,
    company.id
  );
  const userCount = getUserCount(db, company.id);
  const cycle = license?.billing_cycle || 'monthly';

  const billed = subscriptionCompanyBilled(db, company.id);
  const paid = subscriptionCompanyPaid(db, company.id);
  const outstanding = Math.max(0, round2(billed - paid));
  const openInvoices = db
    .prepare("SELECT COUNT(*) AS c FROM subscription_invoices WHERE company_id = ? AND status IN ('Unpaid','Partial')")
    .get(company.id).c;
  const failedPayments = db
    .prepare(
      "SELECT COUNT(*) AS c FROM subscription_events WHERE company_id = ? AND event_type IN ('invoice.payment_failed','payment_intent.payment_failed')"
    )
    .get(company.id).c;

  return {
    companyId: company.id,
    name: company.name,
    domain: company.domain || null,
    companyStatus: company.status,
    licenseStatus: status,
    planId: plan?.id ?? null,
    planKey: plan?.key || null,
    planName: plan?.name || null,
    billingCycle: cycle,
    autoRenew: license ? Boolean(license.auto_renew) : true,
    priceMonthly: plan ? Number(plan.price_monthly) || 0 : 0,
    priceAnnual: plan ? Number(plan.price_annual) || 0 : 0,
    currentPrice: plan ? planPrice(plan, cycle) : 0,
    startsAt: startsAt || null,
    expiresAt: expiresAt || null,
    pastDueAt: license?.past_due_at || null,
    renewalDate: expiresAt || null,
    userLimit,
    userCount,
    storageLimitMb,
    exportEnabled: exportEnabled !== false,
    apiEnabled: apiEnabled !== false,
    modules: moduleKeys,
    billed,
    paid,
    outstanding,
    openInvoices,
    failedPayments,
  };
}

/**
 * Plans available for upgrade/downgrade (no secrets, safe for tenants).
 */
export function listAvailablePlans(db) {
  return db
    .prepare("SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order, id")
    .all()
    .map(planToSummary);
}

function invoiceToJson(db, row, companyName = null) {
  const balance = subscriptionInvoiceBalance(db, row);
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    companyId: row.company_id,
    companyName: companyName || null,
    planId: row.plan_id,
    amount: row.amount,
    description: row.description,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    dueDate: row.due_date,
    billingCycle: row.billing_cycle,
    provider: row.provider,
    paid: round2(subscriptionInvoicePaid(db, row.id)),
    balance,
    status: row.status,
    createdAt: row.created_at,
  };
}

function paymentToJson(row) {
  return {
    id: row.id,
    paymentNo: row.payment_no,
    invoiceId: row.invoice_id,
    invoiceNo: row.invoice_no || null,
    companyId: row.company_id,
    companyName: row.company_name || null,
    amount: row.amount,
    paymentDate: row.payment_date,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    type: row.type,
    provider: row.provider,
    createdAt: row.created_at,
  };
}

const INVOICE_SELECT = `
  SELECT si.*, c.name AS company_name, p.name AS plan_name, p.key AS plan_key
  FROM subscription_invoices si
  JOIN companies c ON c.id = si.company_id
  LEFT JOIN plans p ON p.id = si.plan_id
`;

const PAYMENT_SELECT = `
  SELECT sp.*, c.name AS company_name, si.invoice_no AS invoice_no
  FROM subscription_payments sp
  JOIN subscription_invoices si ON si.id = sp.invoice_id
  JOIN companies c ON c.id = sp.company_id
`;

export function listCompanyInvoices(db, companyId) {
  return db
    .prepare(`${INVOICE_SELECT} WHERE si.company_id = ? ORDER BY si.id DESC`)
    .all(companyId)
    .map((row) => ({ ...invoiceToJson(db, row), planName: row.plan_name || null, planKey: row.plan_key || null }));
}

export function listCompanyPayments(db, companyId) {
  return db
    .prepare(`${PAYMENT_SELECT} WHERE sp.company_id = ? AND sp.deleted_at IS NULL ORDER BY sp.id DESC`)
    .all(companyId)
    .map(paymentToJson);
}

export function listCompanyEvents(db, companyId) {
  return db
    .prepare('SELECT * FROM subscription_events WHERE company_id = ? ORDER BY id DESC')
    .all(companyId)
    .map((e) => ({
      id: e.id,
      provider: e.provider,
      providerEventId: e.provider_event_id,
      eventType: e.event_type,
      companyId: e.company_id,
      invoiceId: e.invoice_id,
      status: e.status,
      processedAt: e.processed_at,
      createdAt: e.created_at,
    }));
}
