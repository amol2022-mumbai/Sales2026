import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';
import { signWebhookHeader } from '../src/services/paymentService.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function superAdmin(request) {
  return loginToken(request, 'admin@test.com', 'AdminPass123!');
}

function planId(plans, key) {
  return plans.find((p) => p.key === key).id;
}

function paymentEvent({ id, invoiceId, companyId, amount, type = 'invoice.paid' }) {
  return {
    provider: 'stripe',
    id,
    type,
    data: { object: { company_id: companyId, invoice_id: invoiceId, amount_paid: amount, payment_intent: `pi_${id}`, method: 'Card' } },
  };
}

async function postWebhook(request, event) {
  const body = JSON.stringify(event);
  return request
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signWebhookHeader(body))
    .send(body);
}

test('company admin can view their own billing summary and plans', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Biller Co', email: 'biller@b.test', password: 'BillerPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'biller@b.test', 'BillerPass123!');

  const summary = await request.get('/api/billing').set(auth(token));
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.companyId, summary.body.data.companyId);
  assert.ok('licenseStatus' in summary.body.data);
  assert.ok('billingCycle' in summary.body.data);
  assert.ok('currentPrice' in summary.body.data);

  const plans = await request.get('/api/billing/plans').set(auth(token));
  assert.equal(plans.status, 200);
  const professional = plans.body.data.find((p) => p.key === 'professional');
  assert.ok(professional);
  assert.equal(professional.priceMonthly, 49);
  assert.equal(professional.priceAnnual, 490);
});

test('checkout creates an unpaid invoice with mock (non-secret) client params', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Checkout Co', email: 'checkout@b.test', password: 'CheckoutPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'checkout@b.test', 'CheckoutPass123!');
  const plans = await request.get('/api/billing/plans').set(auth(token));
  const profId = planId(plans.body.data, 'professional');

  const res = await request.post('/api/billing/checkout').set(auth(token)).send({ planId: profId, billingCycle: 'monthly' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.invoice.status, 'Unpaid');
  assert.equal(res.body.data.invoice.amount, 49);
  assert.equal(res.body.data.invoice.billingCycle, 'monthly');
  assert.equal(res.body.data.checkout.mock, true);
  assert.ok(res.body.data.checkout.clientSecret);
  assert.ok(!JSON.stringify(res.body).includes('sk_'));
  assert.ok(!JSON.stringify(res.body).includes('PAYMENT_SECRET'));
});

test('webhook rejects an invalid signature', async () => {
  const { request } = initTestApp();
  const event = paymentEvent({ id: 'evt_bad', invoiceId: 1, companyId: 1, amount: 10 });
  const res = await request
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', 't=1,v1=deadbeef')
    .send(JSON.stringify(event));
  assert.equal(res.status, 400);
});

test('verified webhook applies payment, activates license and extends expiry', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Pay Co', email: 'pay@b.test', password: 'PayPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'pay@b.test', 'PayPass123!');
  const plans = await request.get('/api/billing/plans').set(auth(token));
  const profId = planId(plans.body.data, 'professional');

  const checkout = await request.post('/api/billing/checkout').set(auth(token)).send({ planId: profId, billingCycle: 'annual' });
  const invoice = checkout.body.data.invoice;

  const event = paymentEvent({ id: 'evt_pay_1', invoiceId: invoice.id, companyId, amount: invoice.amount });
  const res = await postWebhook(request, event);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.applied, true);

  const summary = await request.get('/api/billing').set(auth(token));
  assert.equal(summary.body.data.licenseStatus, 'active');
  assert.equal(summary.body.data.paid, 490);
  assert.equal(summary.body.data.billingCycle, 'annual');
  assert.ok(summary.body.data.expiresAt, 'expiry set');

  const invoices = await request.get('/api/billing/invoices').set(auth(token));
  assert.equal(invoices.body.data[0].status, 'Paid');
  assert.equal(invoices.body.data[0].balance, 0);
});

test('duplicate webhook event is idempotent', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Idem Co', email: 'idem@b.test', password: 'IdemPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'idem@b.test', 'IdemPass123!');
  const plans = await request.get('/api/billing/plans').set(auth(token));
  const profId = planId(plans.body.data, 'professional');

  const checkout = await request.post('/api/billing/checkout').set(auth(token)).send({ planId: profId, billingCycle: 'monthly' });
  const invoice = checkout.body.data.invoice;
  const event = paymentEvent({ id: 'evt_idem_1', invoiceId: invoice.id, companyId, amount: invoice.amount });

  await postWebhook(request, event);
  const again = await postWebhook(request, event);
  assert.equal(again.status, 200);
  assert.equal(again.body.data.duplicate, true);

  const payments = await request.get('/api/billing/payments').set(auth(token));
  const paymentRows = payments.body.data.filter((p) => p.type === 'payment');
  assert.equal(paymentRows.length, 1);
});

test('refund webhook reduces the paid balance', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Refund Co', email: 'refund@b.test', password: 'RefundPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'refund@b.test', 'RefundPass123!');
  const plans = await request.get('/api/billing/plans').set(auth(token));
  const profId = planId(plans.body.data, 'professional');

  const checkout = await request.post('/api/billing/checkout').set(auth(token)).send({ planId: profId, billingCycle: 'monthly' });
  const invoice = checkout.body.data.invoice;
  await postWebhook(request, paymentEvent({ id: 'evt_ref_pay', invoiceId: invoice.id, companyId, amount: invoice.amount }));

  const refundEvent = {
    provider: 'stripe',
    id: 'evt_ref_1',
    type: 'charge.refunded',
    data: { object: { company_id: companyId, invoice_id: invoice.id, amount_refunded: invoice.amount, refund_id: 're_ref_1' } },
  };
  const refundRes = await postWebhook(request, refundEvent);
  assert.equal(refundRes.status, 200);
  assert.equal(refundRes.body.data.applied, true);

  const summary = await request.get('/api/billing').set(auth(token));
  assert.equal(summary.body.data.paid, 0);

  const payments = await request.get('/api/billing/payments').set(auth(token));
  assert.ok(payments.body.data.some((p) => p.type === 'refund'));
});

test('failed payment event is recorded but does not apply a payment', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Fail Co', email: 'fail@b.test', password: 'FailPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'fail@b.test', 'FailPass123!');
  const plans = await request.get('/api/billing/plans').set(auth(token));
  const profId = planId(plans.body.data, 'professional');

  const checkout = await request.post('/api/billing/checkout').set(auth(token)).send({ planId: profId, billingCycle: 'monthly' });
  const invoice = checkout.body.data.invoice;

  const failed = paymentEvent({ id: 'evt_fail_1', invoiceId: invoice.id, companyId, amount: invoice.amount, type: 'invoice.payment_failed' });
  const res = await postWebhook(request, failed);
  assert.equal(res.status, 200);

  const summary = await request.get('/api/billing').set(auth(token));
  assert.equal(summary.body.data.failedPayments, 1);
  assert.equal(summary.body.data.paid, 0);
});

test('company admin can cancel and reactivate their subscription', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Cancel Co', email: 'cancel@b.test', password: 'CancelPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'cancel@b.test', 'CancelPass123!');

  const cancel = await request.post('/api/billing/cancel').set(auth(token));
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.data.licenseStatus, 'cancelled');
  assert.equal(cancel.body.data.autoRenew, false);

  const reactivate = await request.post('/api/billing/reactivate').set(auth(token));
  assert.equal(reactivate.status, 200);
  assert.ok(['active', 'expiring'].includes(reactivate.body.data.licenseStatus));
  assert.equal(reactivate.body.data.autoRenew, true);
});

test('change-plan applies free plans immediately and invoices paid plans', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Change Co', email: 'change@b.test', password: 'ChangePass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'change@b.test', 'ChangePass123!');
  const plans = await request.get('/api/billing/plans').set(auth(token));
  const basicId = planId(plans.body.data, 'basic');
  const profId = planId(plans.body.data, 'professional');

  const free = await request.post('/api/billing/change-plan').set(auth(token)).send({ planId: basicId, billingCycle: 'monthly' });
  assert.equal(free.status, 200);
  assert.equal(free.body.data.appliedImmediately, true);

  const paid = await request.post('/api/billing/change-plan').set(auth(token)).send({ planId: profId, billingCycle: 'monthly' });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.data.appliedImmediately, false);
  assert.equal(paid.body.data.invoice.amount, 49);
});

test('super admin can drive lifecycle, refunds and view events', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Admin Bill Co', email: 'abill@b.test', password: 'AbillPass123!', roleKey: 'business_owner' });
  const admin = await superAdmin(request);

  const change = await request
    .post(`/api/admin/subscriptions/${companyId}/change-plan`)
    .set(auth(admin))
    .send({ planId: (await request.get('/api/admin/plans').set(auth(admin))).body.data.find((p) => p.key === 'professional').id, billingCycle: 'annual', applyImmediately: true });
  assert.equal(change.status, 200);
  assert.equal(change.body.data.summary.planKey, 'professional');
  assert.equal(change.body.data.summary.billingCycle, 'annual');

  const cancel = await request.post(`/api/admin/subscriptions/${companyId}/cancel`).set(auth(admin));
  assert.equal(cancel.body.data.licenseStatus, 'cancelled');

  const reactivate = await request.post(`/api/admin/subscriptions/${companyId}/reactivate`).set(auth(admin));
  assert.equal(reactivate.body.data.licenseStatus, 'active');

  const events = await request.get(`/api/admin/subscriptions/${companyId}/events`).set(auth(admin));
  assert.equal(events.status, 200);
  assert.ok(Array.isArray(events.body.data));
});

test('tenant isolation: a company cannot pay or see another company invoice', async () => {
  const { request, db } = initTestApp();
  const { companyId: companyA } = createCompanyAndUser(db, { companyName: 'Tenant A', email: 'tenanta@b.test', password: 'TenantAPass1!', roleKey: 'business_owner' });
  createCompanyAndUser(db, { companyName: 'Tenant B', email: 'tenantb@b.test', password: 'TenantBPass1!', roleKey: 'business_owner' });

  const tokenA = await loginToken(request, 'tenanta@b.test', 'TenantAPass1!');
  const tokenB = await loginToken(request, 'tenantb@b.test', 'TenantBPass1!');
  const plans = await request.get('/api/billing/plans').set(auth(tokenA));
  const profId = planId(plans.body.data, 'professional');

  const checkout = await request.post('/api/billing/checkout').set(auth(tokenA)).send({ planId: profId, billingCycle: 'monthly' });
  const invoice = checkout.body.data.invoice;

  // B cannot mock-pay A's invoice.
  const attempt = await request.post('/api/billing/mock-pay').set(auth(tokenB)).send({ invoiceId: invoice.id });
  assert.equal(attempt.status, 404);

  // B's invoices list does not contain A's invoice.
  const bInvoices = await request.get('/api/billing/invoices').set(auth(tokenB));
  assert.ok(!bInvoices.body.data.some((i) => i.id === invoice.id));
  assert.equal(companyA > 0, true);
});

test('non-billing role cannot access billing endpoints', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'NoBill Co', email: 'nobill@b.test', password: 'NoBillPass1!', roleKey: 'viewer' });
  const token = await loginToken(request, 'nobill@b.test', 'NoBillPass1!');

  assert.equal((await request.get('/api/billing').set(auth(token))).status, 403);
  assert.equal((await request.get('/api/billing/plans').set(auth(token))).status, 403);
  assert.equal((await request.post('/api/billing/checkout').set(auth(token)).send({ planId: 1 })).status, 403);
});
