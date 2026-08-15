import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';
import { signWebhookHeader } from '../src/services/paymentService.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function superAdmin(request) {
  return loginToken(request, 'admin@test.com', 'AdminPass123!');
}

function insertLicense(db, companyId, { status = 'active', planId = null, expiresAt = null, pastDueAt = null } = {}) {
  db.prepare(
    `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, past_due_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(companyId, planId, status, new Date().toISOString().slice(0, 10), expiresAt, pastDueAt);
}

function failedPaymentEvent({ id, invoiceId, companyId }) {
  return {
    provider: 'stripe',
    id,
    type: 'invoice.payment_failed',
    data: { object: { company_id: companyId, invoice_id: invoiceId } },
  };
}

function paidPaymentEvent({ id, invoiceId, companyId, amount }) {
  return {
    provider: 'stripe',
    id,
    type: 'invoice.paid',
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

test('failed payment webhook moves an active subscription to past_due (grace access allowed)', async () => {
  const { request, db } = initTestApp();
  const profId = db.prepare("SELECT id FROM plans WHERE key = 'professional'").get().id;
  const { companyId } = createCompanyAndUser(db, { companyName: 'PastDue Co', email: 'pd@b.test', password: 'PdPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'active', planId: profId });
  const token = await loginToken(request, 'pd@b.test', 'PdPass123!');

  const checkout = await request.post('/api/billing/checkout').set(auth(token)).send({ planId: profId, billingCycle: 'monthly' });
  assert.equal(checkout.status, 201);
  const invoice = checkout.body.data.invoice;

  const res = await postWebhook(request, failedPaymentEvent({ id: 'evt_pd_1', invoiceId: invoice.id, companyId }));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.failed, true);

  const lic = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId);
  assert.equal(lic.status, 'past_due');
  assert.ok(lic.past_due_at);

  // Grace period: the tenant can still authenticate and access the app.
  const me = await request.get('/api/auth/me').set(auth(token));
  assert.equal(me.status, 200);
  assert.equal(me.body.data.tenant.license.status, 'past_due');

  const billing = await request.get('/api/billing').set(auth(token));
  assert.equal(billing.body.data.licenseStatus, 'past_due');
  assert.ok(billing.body.data.pastDueAt);
});

test('past_due beyond the grace period resolves to suspended and blocks access', async () => {
  const { request, db } = initTestApp();
  const profId = db.prepare("SELECT id FROM plans WHERE key = 'professional'").get().id;
  const { companyId } = createCompanyAndUser(db, { companyName: 'Grace Co', email: 'grace@b.test', password: 'GracePass1!', roleKey: 'business_owner' });
  // Backdate the past_due entry well beyond the grace window.
  const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  insertLicense(db, companyId, { status: 'past_due', planId: profId, pastDueAt: past });
  const token = await loginToken(request, 'grace@b.test', 'GracePass1!');

  const res = await request.get('/api/auth/me').set(auth(token));
  assert.equal(res.status, 403);
  assert.equal(res.body.error?.code, 'LICENSE_SUSPENDED');

  // The derived transition is persisted.
  const lic = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId);
  assert.equal(lic.status, 'suspended');
});

test('a successful payment after past_due clears the past-due state and reactivates', async () => {
  const { request, db } = initTestApp();
  const profId = db.prepare("SELECT id FROM plans WHERE key = 'professional'").get().id;
  const { companyId } = createCompanyAndUser(db, { companyName: 'Recover Co', email: 'recover@b.test', password: 'RecoverPass1!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'active', planId: profId });
  const token = await loginToken(request, 'recover@b.test', 'RecoverPass1!');

  const checkout = await request.post('/api/billing/checkout').set(auth(token)).send({ planId: profId, billingCycle: 'monthly' });
  const invoice = checkout.body.data.invoice;

  await postWebhook(request, failedPaymentEvent({ id: 'evt_pd_rec_1', invoiceId: invoice.id, companyId }));
  assert.equal(db.prepare('SELECT status FROM licenses WHERE company_id = ?').get(companyId).status, 'past_due');

  const paid = await postWebhook(request, paidPaymentEvent({ id: 'evt_pd_rec_pay', invoiceId: invoice.id, companyId, amount: invoice.amount }));
  assert.equal(paid.status, 200);
  assert.equal(paid.body.data.applied, true);

  const lic = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId);
  assert.equal(lic.status, 'active');
  assert.equal(lic.past_due_at, null);
});

test('super admin can suspend and reactivate a subscription (past_due -> suspended control)', async () => {
  const { request, db } = initTestApp();
  const profId = db.prepare("SELECT id FROM plans WHERE key = 'professional'").get().id;
  const { companyId } = createCompanyAndUser(db, { companyName: 'Suspend Co', email: 'suspend@b.test', password: 'SuspendPass1!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'active', planId: profId });
  const token = await loginToken(request, 'suspend@b.test', 'SuspendPass1!');
  const admin = await superAdmin(request);

  const suspend = await request.post(`/api/admin/subscriptions/${companyId}/suspend`).set(auth(admin));
  assert.equal(suspend.status, 200);
  assert.equal(suspend.body.data.licenseStatus, 'suspended');

  const blocked = await request.get('/api/auth/me').set(auth(token));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error?.code, 'LICENSE_SUSPENDED');

  const reactivate = await request.post(`/api/admin/subscriptions/${companyId}/reactivate`).set(auth(admin));
  assert.equal(reactivate.status, 200);
  assert.ok(['active', 'expiring'].includes(reactivate.body.data.licenseStatus));

  const ok = await request.get('/api/auth/me').set(auth(token));
  assert.equal(ok.status, 200);
});

test('super admin can set a license to past_due via upsertLicense', async () => {
  const { request, db } = initTestApp();
  const profId = db.prepare("SELECT id FROM plans WHERE key = 'professional'").get().id;
  const { companyId } = createCompanyAndUser(db, { companyName: 'Upsert Co', email: 'upsert@b.test', password: 'UpsertPass1!', roleKey: 'business_owner' });
  const admin = await superAdmin(request);

  const res = await request
    .put(`/api/admin/licenses/${companyId}`)
    .set(auth(admin))
    .send({ planId: profId, status: 'past_due' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'past_due');

  const lic = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId);
  assert.ok(lic.past_due_at);
});

test('tenant isolation: a failed payment for one tenant does not affect another', async () => {
  const { request, db } = initTestApp();
  const profId = db.prepare("SELECT id FROM plans WHERE key = 'professional'").get().id;
  const { companyId: companyA } = createCompanyAndUser(db, { companyName: 'Iso A', email: 'isoa@b.test', password: 'IsoAPass1!', roleKey: 'business_owner' });
  const { companyId: companyB } = createCompanyAndUser(db, { companyName: 'Iso B', email: 'isob@b.test', password: 'IsoBPass1!', roleKey: 'business_owner' });
  insertLicense(db, companyA, { status: 'active', planId: profId });
  insertLicense(db, companyB, { status: 'active', planId: profId });

  const tokenA = await loginToken(request, 'isoa@b.test', 'IsoAPass1!');
  const tokenB = await loginToken(request, 'isob@b.test', 'IsoBPass1!');

  const checkout = await request.post('/api/billing/checkout').set(auth(tokenA)).send({ planId: profId, billingCycle: 'monthly' });
  const invoice = checkout.body.data.invoice;

  await postWebhook(request, failedPaymentEvent({ id: 'evt_iso_a_1', invoiceId: invoice.id, companyId: companyA }));

  assert.equal(db.prepare('SELECT status FROM licenses WHERE company_id = ?').get(companyA).status, 'past_due');
  assert.equal(db.prepare('SELECT status FROM licenses WHERE company_id = ?').get(companyB).status, 'active');

  // B's billing data does not include A's invoice, and B cannot reach admin APIs.
  const bBilling = await request.get('/api/billing').set(auth(tokenB));
  assert.equal(bBilling.status, 200);
  assert.equal(bBilling.body.data.licenseStatus, 'active');
  assert.equal((await request.get('/api/admin/subscriptions').set(auth(tokenB))).status, 403);
});

test('past_due is surfaced in admin subscriptions and operations overview', async () => {
  const { request, db } = initTestApp();
  const profId = db.prepare("SELECT id FROM plans WHERE key = 'professional'").get().id;
  const { companyId } = createCompanyAndUser(db, { companyName: 'Ops Co', email: 'ops@b.test', password: 'OpsPass1!', roleKey: 'business_owner' });
  const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  insertLicense(db, companyId, { status: 'past_due', planId: profId, pastDueAt: past });
  const admin = await superAdmin(request);

  const subs = await request.get('/api/admin/subscriptions').set(auth(admin));
  assert.equal(subs.status, 200);
  const entry = subs.body.data.find((s) => s.companyId === companyId);
  assert.ok(entry);
  assert.equal(entry.licenseStatus, 'past_due');
  assert.equal(entry.pastDueAt, past);

  const ops = await request.get('/api/admin/operations').set(auth(admin));
  assert.equal(ops.status, 200);
  assert.ok(ops.body.data.totals.licenses.pastDue >= 1);
});
