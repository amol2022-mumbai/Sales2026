import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function planId(plans, key) {
  return plans.find((p) => p.key === key).id;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function insertLicense(db, companyId, { status = 'active', planId = null, pastDueAt = null, expiresAt = null } = {}) {
  return Number(
    db
      .prepare(`INSERT INTO licenses (company_id, plan_id, status, past_due_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
      .run(companyId, planId, status, pastDueAt, expiresAt).lastInsertRowid
  );
}

async function superAdminToken(request) {
  return loginToken(request, 'admin@test.com', 'AdminPass123!');
}

async function createActivePlan(request, admin, { key, name, modules = [], limits = {}, priceMonthly = 0 }) {
  const res = await request.post('/api/admin/plans').set(auth(admin)).send({ key, name, modules, limits, priceMonthly });
  assert.equal(res.status, 201, `create plan ${key}`);
  return res.body.data;
}

// ---------------------------------------------------------------------------
// Plan visibility (tenant-facing, no secrets).
// ---------------------------------------------------------------------------

test('plan list exposes comparison data (limits, features) and hides inactive plans', async () => {
  const { request, db } = initTestApp();
  const admin = await superAdminToken(request);

  await createActivePlan(request, admin, {
    key: 'cmp_plan',
    name: 'Comparison Plan',
    modules: ['leads', 'customers'],
    limits: { leads: 10, customers: 5, ai_requests: 100 },
    priceMonthly: 29,
  });

  const hidden = await createActivePlan(request, admin, { key: 'hidden_plan', name: 'Hidden Plan' });
  db.prepare('UPDATE plans SET is_active = 0 WHERE id = ?').run(hidden.id);

  const { companyId } = createCompanyAndUser(db, { companyName: 'Vis Co', email: 'vis@b.test', password: 'VisPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'vis@b.test', 'VisPass123!');

  const plans = await request.get('/api/billing/plans').set(auth(token));
  assert.equal(plans.status, 200);
  const cmp = plans.body.data.find((p) => p.key === 'cmp_plan');
  assert.ok(cmp, 'active plan is listed');
  assert.deepEqual(cmp.limits, { leads: 10, customers: 5, ai_requests: 100 });
  assert.deepEqual(cmp.features, [
    { key: 'leads', label: 'Leads' },
    { key: 'customers', label: 'Customers' },
  ]);
  assert.equal(cmp.priceMonthly, 29);
  assert.equal(cmp.userLimit, -1);

  assert.equal(plans.body.data.some((p) => p.key === 'hidden_plan'), false, 'inactive plan is hidden');

  for (const p of plans.body.data) {
    assert.equal(p.license_duration_days, undefined, 'internal column not leaked');
    assert.equal(p.created_at, undefined, 'internal column not leaked');
  }
});

test('plan list is denied to users without billing:view', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Viewer Co', email: 'viewer@b.test', password: 'ViewerPass1!', roleKey: 'viewer' });
  const token = await loginToken(request, 'viewer@b.test', 'ViewerPass1!');

  assert.equal((await request.get('/api/billing/plans').set(auth(token))).status, 403);
  assert.equal((await request.get('/api/billing').set(auth(token))).status, 403);
  assert.equal((await request.get('/api/billing/usage').set(auth(token))).status, 403);
});

// ---------------------------------------------------------------------------
// Authorized plan changes (RBAC: billing:view vs billing:edit).
// ---------------------------------------------------------------------------

test('billing:view role can read but not mutate billing', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Manager Co', email: 'mgr@b.test', password: 'MgrPass123!', roleKey: 'sales_manager' });
  const token = await loginToken(request, 'mgr@b.test', 'MgrPass123!');
  const plans = await request.get('/api/billing/plans').set(auth(token));
  const basicId = planId(plans.body.data, 'basic');

  assert.equal((await request.get('/api/billing').set(auth(token))).status, 200);
  assert.equal((await request.post('/api/billing/change-plan').set(auth(token)).send({ planId: basicId })).status, 403);
  assert.equal((await request.post('/api/billing/cancel').set(auth(token))).status, 403);
  assert.equal((await request.post('/api/billing/renew').set(auth(token))).status, 403);
  assert.equal((await request.post('/api/billing/reactivate').set(auth(token))).status, 403);
});

// ---------------------------------------------------------------------------
// Entitlement updates after a free plan change (immediate).
// ---------------------------------------------------------------------------

test('free plan change applies immediately and updates entitlements for the tenant only', async () => {
  const { request, db } = initTestApp();
  const admin = await superAdminToken(request);

  const small = await createActivePlan(request, admin, { key: 'small_free', name: 'Small Free', modules: ['leads'], limits: { leads: 2 } });
  const big = await createActivePlan(request, admin, { key: 'big_free', name: 'Big Free', modules: ['leads'], limits: { leads: 50 } });

  const a = createCompanyAndUser(db, { companyName: 'Free A', email: 'freea@b.test', password: 'FreeA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Free B', email: 'freeb@b.test', password: 'FreeB123!', roleKey: 'business_owner' });
  insertLicense(db, a.companyId, { planId: small.id, status: 'active' });
  insertLicense(db, b.companyId, { planId: small.id, status: 'active' });

  const tokenA = await loginToken(request, 'freea@b.test', 'FreeA123!');
  const tokenB = await loginToken(request, 'freeb@b.test', 'FreeB123!');

  const beforeA = await request.get('/api/billing/usage').set(auth(tokenA));
  assert.equal(beforeA.body.data.find((u) => u.key === 'leads').limit, 2);

  const change = await request.post('/api/billing/change-plan').set(auth(tokenA)).send({ planId: big.id, billingCycle: 'monthly' });
  assert.equal(change.status, 200);
  assert.equal(change.body.data.appliedImmediately, true);
  assert.equal(change.body.data.summary.planKey, 'big_free');
  assert.equal(change.body.data.summary.limits.leads, 50);

  const afterA = await request.get('/api/billing/usage').set(auth(tokenA));
  assert.equal(afterA.body.data.find((u) => u.key === 'leads').limit, 50, 'tenant A limit updated');

  const afterB = await request.get('/api/billing/usage').set(auth(tokenB));
  assert.equal(afterB.body.data.find((u) => u.key === 'leads').limit, 2, 'tenant B limit unaffected');
});

// ---------------------------------------------------------------------------
// Entitlement updates after a paid plan change (via verified payment).
// ---------------------------------------------------------------------------

test('paid plan change is deferred until verified payment, then entitlements update', async () => {
  const { request, db } = initTestApp();
  const admin = await superAdminToken(request);

  const paid = await createActivePlan(request, admin, {
    key: 'paid_plan',
    name: 'Paid Plan',
    modules: ['leads'],
    limits: { exports: 3 },
    priceMonthly: 10,
  });

  const { companyId } = createCompanyAndUser(db, { companyName: 'Paid Co', email: 'paid@b.test', password: 'Paid123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'paid@b.test', 'Paid123!');

  const change = await request.post('/api/billing/change-plan').set(auth(token)).send({ planId: paid.id, billingCycle: 'monthly' });
  assert.equal(change.status, 201);
  assert.equal(change.body.data.appliedImmediately, false);
  const invoiceId = change.body.data.invoice.id;

  const before = await request.get('/api/billing').set(auth(token));
  assert.notEqual(before.body.data.planKey, 'paid_plan', 'plan not applied before payment');

  const pay = await request.post('/api/billing/mock-pay').set(auth(token)).send({ invoiceId });
  assert.equal(pay.status, 200);
  assert.equal(pay.body.data.summary.planKey, 'paid_plan');

  const usage = await request.get('/api/billing/usage').set(auth(token));
  assert.equal(usage.body.data.find((u) => u.key === 'exports').limit, 3, 'entitlements reflect paid plan after payment');
});

// ---------------------------------------------------------------------------
// Usage display scoped to the authenticated tenant.
// ---------------------------------------------------------------------------

test('billing summary and usage are scoped to the authenticated tenant', async () => {
  const { request, db } = initTestApp();
  const admin = await superAdminToken(request);
  const plan = await createActivePlan(request, admin, { key: 'usage_plan', name: 'Usage Plan', modules: ['leads'], limits: { leads: 2 } });

  const a = createCompanyAndUser(db, { companyName: 'Usage A', email: 'usagea@b.test', password: 'UsageA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Usage B', email: 'usageb@b.test', password: 'UsageB123!', roleKey: 'business_owner' });
  insertLicense(db, a.companyId, { planId: plan.id, status: 'active' });
  insertLicense(db, b.companyId, { planId: plan.id, status: 'active' });

  const tokenA = await loginToken(request, 'usagea@b.test', 'UsageA123!');
  const tokenB = await loginToken(request, 'usageb@b.test', 'UsageB123!');

  await request.post('/api/leads').set(auth(tokenA)).send({ companyName: 'Prospect A1' });
  await request.post('/api/leads').set(auth(tokenA)).send({ companyName: 'Prospect A2' });

  const usageA = await request.get('/api/billing/usage').set(auth(tokenA));
  assert.equal(usageA.body.data.find((u) => u.key === 'leads').usage, 2);
  assert.equal(usageA.body.data.find((u) => u.key === 'leads').remaining, 0);

  const usageB = await request.get('/api/billing/usage').set(auth(tokenB));
  assert.equal(usageB.body.data.find((u) => u.key === 'leads').usage, 0, 'tenant B sees only its own usage');

  const summaryA = await request.get('/api/billing').set(auth(tokenA));
  assert.equal(summaryA.body.data.companyId, a.companyId);
  assert.equal(summaryA.body.data.limits.leads, 2);
  assert.equal(summaryA.body.data.userCount, 1);
});

// ---------------------------------------------------------------------------
// Subscription-state restrictions (past_due / grace / expired / suspended / cancelled).
// ---------------------------------------------------------------------------

test('past_due tenant keeps access during grace and sees a grace deadline', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Due Co', email: 'due@b.test', password: 'Due123!', roleKey: 'business_owner' });
  const today = new Date().toISOString().slice(0, 10);
  insertLicense(db, companyId, { status: 'past_due', pastDueAt: today });

  const token = await loginToken(request, 'due@b.test', 'Due123!');

  const summary = await request.get('/api/billing').set(auth(token));
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.licenseStatus, 'past_due');
  assert.equal(summary.body.data.graceEndsAt, addDays(today, 14));

  const lead = await request.post('/api/leads').set(auth(token)).send({ companyName: 'During Grace' });
  assert.equal(lead.status, 201, 'access allowed during grace period');
});

test('expired tenant is blocked from features but can still reach billing', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Expired Co', email: 'exp@b.test', password: 'Exp123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'expired', expiresAt: '2020-01-01' });

  const token = await loginToken(request, 'exp@b.test', 'Exp123!');

  const summary = await request.get('/api/billing').set(auth(token));
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.licenseStatus, 'expired');

  const lead = await request.post('/api/leads').set(auth(token)).send({ companyName: 'Blocked' });
  assert.equal(lead.status, 403);
  assert.equal(lead.body.error.code, 'LICENSE_EXPIRED');
});

test('suspended tenant is blocked from features but can still reach billing', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Suspended Co', email: 'susp@b.test', password: 'Susp123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'suspended' });

  const token = await loginToken(request, 'susp@b.test', 'Susp123!');

  const summary = await request.get('/api/billing').set(auth(token));
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.licenseStatus, 'suspended');

  const lead = await request.post('/api/leads').set(auth(token)).send({ companyName: 'Blocked' });
  assert.equal(lead.status, 403);
  assert.equal(lead.body.error.code, 'LICENSE_SUSPENDED');
});

test('cancelled tenant can reactivate from billing and restore access', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Cancelled Co', email: 'cancel@b.test', password: 'Cancel123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'cancelled' });

  const token = await loginToken(request, 'cancel@b.test', 'Cancel123!');

  const summary = await request.get('/api/billing').set(auth(token));
  assert.equal(summary.body.data.licenseStatus, 'cancelled');

  const lead = await request.post('/api/leads').set(auth(token)).send({ companyName: 'Blocked' });
  assert.equal(lead.status, 403);
  assert.equal(lead.body.error.code, 'LICENSE_CANCELLED');

  const reactivate = await request.post('/api/billing/reactivate').set(auth(token));
  assert.equal(reactivate.status, 200);
  assert.ok(['active', 'expiring'].includes(reactivate.body.data.licenseStatus), 'license restored from cancelled');

  const restored = await request.post('/api/leads').set(auth(token)).send({ companyName: 'Restored' });
  assert.equal(restored.status, 201, 'access restored after reactivation');
});
