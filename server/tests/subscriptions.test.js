import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function superAdmin(request) {
  return loginToken(request, 'admin@test.com', 'AdminPass123!');
}

test('super admin can list subscriptions with derived billing summary', async () => {
  const { request, db, seed } = initTestApp();
  const admin = await superAdmin(request);
  createCompanyAndUser(db, { companyName: 'Billing Co', email: 'billing@b.test', password: 'BillingPass123!', roleKey: 'business_owner' });

  const res = await request.get('/api/admin/subscriptions').set(auth(admin));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 2);

  const seedSub = res.body.data.find((s) => s.companyId === seed.companyId);
  assert.ok(seedSub, 'seed company present in subscriptions');
  assert.equal(seedSub.billed, 0);
  assert.equal(seedSub.paid, 0);
  assert.equal(seedSub.outstanding, 0);
  assert.equal(seedSub.openInvoices, 0);
});

test('super admin can issue a subscription invoice with derived status', async () => {
  const { request, seed } = initTestApp();
  const admin = await superAdmin(request);

  const res = await request
    .post(`/api/admin/subscriptions/${seed.companyId}/invoices`)
    .set(auth(admin))
    .send({ amount: 49, periodStart: '2026-08-01', periodEnd: '2026-08-31', dueDate: '2026-08-05' });

  assert.equal(res.status, 201);
  assert.match(res.body.data.invoiceNo, /^SINV-\d{6}$/);
  assert.equal(res.body.data.companyId, seed.companyId);
  assert.equal(res.body.data.amount, 49);
  assert.equal(res.body.data.status, 'Unpaid');
  assert.equal(res.body.data.balance, 49);
});

test('recording subscription payments derives Partial then Paid status', async () => {
  const { request, seed } = initTestApp();
  const admin = await superAdmin(request);

  const inv = await request
    .post(`/api/admin/subscriptions/${seed.companyId}/invoices`)
    .set(auth(admin))
    .send({ amount: 100, periodStart: '2026-08-01', periodEnd: '2026-08-31', dueDate: '2026-08-05' });
  const invoiceId = inv.body.data.id;

  const p1 = await request
    .post(`/api/admin/subscriptions/invoices/${invoiceId}/payments`)
    .set(auth(admin))
    .send({ amount: 40, paymentDate: '2026-08-10' });
  assert.equal(p1.status, 201);
  assert.match(p1.body.data.paymentNo, /^SPAY-\d{6}$/);

  let detail = await request.get(`/api/admin/subscriptions/${seed.companyId}`).set(auth(admin));
  let invRow = detail.body.data.invoices.find((i) => i.id === invoiceId);
  assert.equal(invRow.status, 'Partial');
  assert.equal(invRow.balance, 60);
  assert.equal(detail.body.data.paid, 40);
  assert.equal(detail.body.data.outstanding, 60);

  await request
    .post(`/api/admin/subscriptions/invoices/${invoiceId}/payments`)
    .set(auth(admin))
    .send({ amount: 60, paymentDate: '2026-08-11' });

  detail = await request.get(`/api/admin/subscriptions/${seed.companyId}`).set(auth(admin));
  invRow = detail.body.data.invoices.find((i) => i.id === invoiceId);
  assert.equal(invRow.status, 'Paid');
  assert.equal(invRow.balance, 0);
  assert.equal(detail.body.data.billed, 100);
  assert.equal(detail.body.data.paid, 100);
  assert.equal(detail.body.data.outstanding, 0);
});

test('non-super-admin cannot access subscription endpoints', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Rogue Co', email: 'rogue@b.test', password: 'RoguePass123!', roleKey: 'business_owner' });
  const rogue = await loginToken(request, 'rogue@b.test', 'RoguePass123!');

  assert.equal((await request.get('/api/admin/subscriptions').set(auth(rogue))).status, 403);
  assert.equal((await request.post('/api/admin/subscriptions/1/invoices').set(auth(rogue)).send({ amount: 10 })).status, 403);
});

test('unknown client is rejected with 404', async () => {
  const { request } = initTestApp();
  const admin = await superAdmin(request);

  assert.equal((await request.get('/api/admin/subscriptions/999999').set(auth(admin))).status, 404);
  assert.equal(
    (await request.post('/api/admin/subscriptions/999999/invoices').set(auth(admin)).send({ amount: 10 })).status,
    404
  );
});

test('subscription invoice and payment mutations write audit logs', async () => {
  const { request, db, seed } = initTestApp();
  const admin = await superAdmin(request);

  const inv = await request
    .post(`/api/admin/subscriptions/${seed.companyId}/invoices`)
    .set(auth(admin))
    .send({ amount: 20, dueDate: '2026-08-05' });
  const invoiceId = inv.body.data.id;

  await request
    .post(`/api/admin/subscriptions/invoices/${invoiceId}/payments`)
    .set(auth(admin))
    .send({ amount: 20, paymentDate: '2026-08-06' });

  const actions = db
    .prepare("SELECT action FROM audit_logs WHERE entity_type IN ('subscription_invoice','subscription_payment')")
    .all()
    .map((r) => r.action);
  assert.ok(actions.includes('subscription.invoice.create'));
  assert.ok(actions.includes('subscription.payment.create'));
});

test('negative invoice amount is rejected', async () => {
  const { request, seed } = initTestApp();
  const admin = await superAdmin(request);

  const res = await request
    .post(`/api/admin/subscriptions/${seed.companyId}/invoices`)
    .set(auth(admin))
    .send({ amount: -1 });
  assert.equal(res.status, 400);
});
