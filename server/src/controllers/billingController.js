// ============================================================================
// Billing controller (Phase 14). Company-scoped billing endpoints (current
// plan, pricing, lifecycle actions) plus the raw payment-provider webhook
// handler. Payment state is only ever applied from verified webhook events.
// ============================================================================

import { getDb } from '../db/connection.js';
import { badRequest, forbidden, notFound } from '../lib/httpError.js';
import { ok, created } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { paymentProvider, isMockMode, createCheckoutSession, mockPaymentIntentId, verifyWebhookHeader } from '../services/paymentService.js';
import {
  getCompanyBillingSummary,
  listAvailablePlans,
  listCompanyInvoices,
  listCompanyPayments,
  listCompanyEvents,
  changePlan,
  renewSubscription,
  cancelSubscription,
  reactivateSubscription,
  createSubscriptionInvoice,
  planPrice,
  processWebhookEvent,
} from '../services/billingService.js';

function tenantCompany(req) {
  const company = req.tenant?.company ?? null;
  if (!company) throw forbidden('A company scope is required for billing');
  return company;
}

// ---------------------------------------------------------------------------
// Company billing page.
// ---------------------------------------------------------------------------
export const getBilling = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = tenantCompany(req);
  return ok(res, getCompanyBillingSummary(db, company));
});

export const getBillingPlans = asyncHandler(async (_req, res) => {
  return ok(res, listAvailablePlans(getDb()));
});

export const getBillingInvoices = asyncHandler(async (req, res) => {
  const company = tenantCompany(req);
  return ok(res, listCompanyInvoices(getDb(), company.id));
});

export const getBillingPayments = asyncHandler(async (req, res) => {
  const company = tenantCompany(req);
  return ok(res, listCompanyPayments(getDb(), company.id));
});

export const getBillingEvents = asyncHandler(async (req, res) => {
  const company = tenantCompany(req);
  return ok(res, listCompanyEvents(getDb(), company.id));
});

/**
 * Create a checkout session for a plan + cycle. Creates an unpaid subscription
 * invoice and returns only non-sensitive client parameters.
 */
export const checkout = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = tenantCompany(req);
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.body.planId);
  if (!plan) throw notFound('Plan not found');

  const cycle = req.body.billingCycle;
  const price = planPrice(plan, cycle);
  const invoice = createSubscriptionInvoice(db, {
    companyId: company.id,
    planId: plan.id,
    cycle,
    amount: price,
    description: `${plan.name} — ${cycle === 'annual' ? 'Annual' : 'Monthly'} subscription`,
    actorUserId: req.user.id,
  });

  req.audit?.('billing.checkout', { entityType: 'subscription_invoice', entityId: invoice.id, metadata: { planId: plan.id, cycle, amount: price } });

  const checkout = createCheckoutSession({
    invoiceId: invoice.id,
    amount: price,
    currency: company.currency || 'USD',
    description: invoice.description,
    companyId: company.id,
  });

  return created(res, { invoice: { id: invoice.id, invoiceNo: invoice.invoice_no, amount: invoice.amount, billingCycle: invoice.billing_cycle, status: invoice.status }, checkout });
});

export const changePlanAction = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = tenantCompany(req);
  const result = changePlan(db, {
    companyId: company.id,
    planId: req.body.planId,
    cycle: req.body.billingCycle,
    actorUserId: req.user.id,
    applyImmediately: false,
  });

  req.audit?.('billing.change_plan', { entityType: 'company', entityId: company.id, metadata: { planId: req.body.planId, cycle: req.body.billingCycle } });

  if (result.appliedImmediately) {
    return ok(res, { appliedImmediately: true, summary: getCompanyBillingSummary(db, company) });
  }
  const checkout = createCheckoutSession({
    invoiceId: result.invoice.id,
    amount: result.price,
    currency: company.currency || 'USD',
    description: result.invoice.description,
    companyId: company.id,
  });
  return created(res, { appliedImmediately: false, invoice: { id: result.invoice.id, invoiceNo: result.invoice.invoice_no, amount: result.invoice.amount, billingCycle: result.invoice.billing_cycle, status: result.invoice.status }, checkout });
});

export const renewAction = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = tenantCompany(req);
  const result = renewSubscription(db, { companyId: company.id, cycle: req.body.billingCycle ?? null, actorUserId: req.user.id });

  req.audit?.('billing.renew', { entityType: 'company', entityId: company.id, metadata: { cycle: req.body.billingCycle ?? null } });

  if (result.appliedImmediately) {
    return ok(res, { appliedImmediately: true, summary: getCompanyBillingSummary(db, company) });
  }
  const checkout = createCheckoutSession({
    invoiceId: result.invoice.id,
    amount: result.price,
    currency: company.currency || 'USD',
    description: result.invoice.description,
    companyId: company.id,
  });
  return created(res, { appliedImmediately: false, invoice: { id: result.invoice.id, invoiceNo: result.invoice.invoice_no, amount: result.invoice.amount, billingCycle: result.invoice.billing_cycle, status: result.invoice.status }, checkout });
});

export const cancelAction = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = tenantCompany(req);
  cancelSubscription(db, { companyId: company.id, actorUserId: req.user.id });
  req.audit?.('billing.cancel', { entityType: 'company', entityId: company.id });
  return ok(res, getCompanyBillingSummary(db, company));
});

export const reactivateAction = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = tenantCompany(req);
  reactivateSubscription(db, { companyId: company.id, actorUserId: req.user.id });
  req.audit?.('billing.reactivate', { entityType: 'company', entityId: company.id });
  return ok(res, getCompanyBillingSummary(db, company));
});

/**
 * Mock completion of a checkout (only in mock/test mode). Simulates the
 * provider sending a signed, verified payment event so the full lifecycle path
 * runs server-side. Disabled when a real provider secret is configured.
 */
export const mockPay = asyncHandler(async (req, res) => {
  const db = getDb();
  if (!isMockMode()) throw badRequest('Mock payments are disabled when a real payment provider is configured');
  const company = tenantCompany(req);

  const invoice = db.prepare('SELECT * FROM subscription_invoices WHERE id = ? AND company_id = ?').get(req.body.invoiceId, company.id);
  if (!invoice) throw notFound('Invoice not found');

  const event = {
    provider: paymentProvider(),
    id: `evt_mock_${Date.now()}_${invoice.id}`,
    type: 'invoice.paid',
    data: {
      object: {
        company_id: company.id,
        invoice_id: invoice.id,
        amount_paid: invoice.amount,
        payment_intent: mockPaymentIntentId(invoice.id),
        method: 'Card',
      },
    },
  };

  const result = processWebhookEvent(db, event);
  req.audit?.('billing.mock.pay', { entityType: 'subscription_invoice', entityId: invoice.id, metadata: { amount: invoice.amount } });
  return ok(res, { ...result, summary: getCompanyBillingSummary(db, company) });
});

// ---------------------------------------------------------------------------
// Webhook (no auth — verified by signature).
// ---------------------------------------------------------------------------
export const webhook = asyncHandler(async (req, res) => {
  const db = getDb();
  const rawBody = req.body && req.body.length ? req.body.toString('utf8') : '';
  const signature = req.headers['stripe-signature'] || req.headers['x-payment-signature'] || '';

  if (!verifyWebhookHeader(rawBody, signature)) {
    throw badRequest('Invalid webhook signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw badRequest('Invalid webhook payload');
  }

  const result = processWebhookEvent(db, event);
  return ok(res, { received: true, ...result });
});
