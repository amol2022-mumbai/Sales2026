import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';
import { consumeUsage, getFeatureUsage, getFeatureLimit } from '../src/services/entitlementService.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function insertLicense(db, companyId, { status = 'active', planId = null } = {}) {
  return Number(
    db
      .prepare(`INSERT INTO licenses (company_id, plan_id, status) VALUES (?, ?, ?)`)
      .run(companyId, planId, status).lastInsertRowid
  );
}

// ---------------------------------------------------------------------------
// Super Admin: plan definitions with feature limits persist and round-trip.
// ---------------------------------------------------------------------------

test('plan feature limits persist and round-trip via Super Admin', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({
    key: 'limited_plan',
    name: 'Limited Plan',
    modules: ['leads', 'customers', 'ai_assistant'],
    apiEnabled: true,
    limits: { leads: 10, customers: 5, ai_requests: 100, exports: 20 },
  });
  assert.equal(plan.status, 201);
  assert.deepEqual(plan.body.data.limits, { leads: 10, customers: 5, ai_requests: 100, exports: 20 });

  const list = await request.get('/api/admin/plans').set(auth(admin));
  const found = list.body.data.find((p) => p.key === 'limited_plan');
  assert.equal(found.limits.leads, 10);
  assert.equal(found.limits.ai_requests, 100);

  const updated = await request.put(`/api/admin/plans/${plan.body.data.id}`).set(auth(admin)).send({ limits: { leads: 3, ai_requests: 50 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.limits.leads, 3);
  assert.equal(updated.body.data.limits.ai_requests, 50);
  assert.equal(updated.body.data.limits.customers, undefined, 'replaced limits drop unset features');
});

test('Super Admin rejects unknown feature limit keys', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({ key: 'bad_plan', name: 'Bad', limits: { not_a_feature: 5 } });
  assert.equal(plan.status, 400);
  assert.equal(plan.body.error.code, 'BAD_REQUEST');
});

// ---------------------------------------------------------------------------
// Per-license overrides win over plan defaults (Super Admin view/manage).
// ---------------------------------------------------------------------------

test('license limit override wins over plan default and is visible to Super Admin', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({ key: 'ovr_plan', name: 'Override Plan', modules: ['leads'], limits: { leads: 10 } });
  const planId = plan.body.data.id;

  const client = await request.post('/api/admin/clients').set(auth(admin)).send({ name: 'Override Tenant' });
  const clientId = client.body.data.id;

  const lic = await request.put(`/api/admin/licenses/${clientId}`).set(auth(admin)).send({ status: 'active', planId, limits: { leads: 2 } });
  assert.equal(lic.status, 200);

  const ent = await request.get(`/api/admin/clients/${clientId}/entitlements`).set(auth(admin));
  assert.equal(ent.status, 200);
  assert.equal(ent.body.data.plan.key, 'ovr_plan');
  assert.equal(ent.body.data.limits.leads, 2, 'license override wins');
  assert.equal(ent.body.data.licenseStatus, 'active');
});

// ---------------------------------------------------------------------------
// Absolute usage limits (leads / customers) with exhaustion.
// ---------------------------------------------------------------------------

test('absolute leads limit is enforced server-side and blocks creation when exhausted', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({ key: 'lead_cap', name: 'Lead Cap', modules: ['leads'], limits: { leads: 2 } });
  const { companyId } = createCompanyAndUser(db, { companyName: 'Lead Co', email: 'leadcap@b.test', password: 'LeadCap123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { planId: plan.body.data.id, status: 'active' });

  const token = await loginToken(request, 'leadcap@b.test', 'LeadCap123!');

  const a = await request.post('/api/leads').set(auth(token)).send({ companyName: 'Prospect A' });
  const b = await request.post('/api/leads').set(auth(token)).send({ companyName: 'Prospect B' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const c = await request.post('/api/leads').set(auth(token)).send({ companyName: 'Prospect C' });
  assert.equal(c.status, 403);
  assert.equal(c.body.error.code, 'LIMIT_REACHED');
  assert.equal(c.body.error.details.feature, 'leads');
});

test('absolute customers limit is enforced server-side', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({ key: 'cust_cap', name: 'Customer Cap', modules: ['customers'], limits: { customers: 1 } });
  const { companyId } = createCompanyAndUser(db, { companyName: 'Cust Co', email: 'custcap@b.test', password: 'CustCap123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { planId: plan.body.data.id, status: 'active' });

  const token = await loginToken(request, 'custcap@b.test', 'CustCap123!');

  const first = await request.post('/api/customers').set(auth(token)).send({ name: 'Acme Inc' });
  assert.equal(first.status, 201);

  const second = await request.post('/api/customers').set(auth(token)).send({ name: 'Globex' });
  assert.equal(second.status, 403);
  assert.equal(second.body.error.code, 'LIMIT_REACHED');
});

// ---------------------------------------------------------------------------
// Metered monthly usage (ai_requests) with exhaustion + reporting.
// ---------------------------------------------------------------------------

test('monthly ai_requests limit is consumed and blocks when exhausted', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({
    key: 'ai_cap',
    name: 'AI Cap',
    modules: ['ai_assistant'],
    apiEnabled: true,
    limits: { ai_requests: 2 },
  });
  const { companyId } = createCompanyAndUser(db, { companyName: 'AI Co', email: 'aicap@b.test', password: 'AiCap123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { planId: plan.body.data.id, status: 'active' });

  const token = await loginToken(request, 'aicap@b.test', 'AiCap123!');

  const q = { question: 'What were our sales this month?' };
  assert.equal((await request.post('/api/ai/ask').set(auth(token)).send(q)).status, 200);
  assert.equal((await request.post('/api/ai/ask').set(auth(token)).send(q)).status, 200);

  const blocked = await request.post('/api/ai/ask').set(auth(token)).send(q);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'LIMIT_REACHED');
  assert.equal(blocked.body.error.details.feature, 'ai_requests');

  const usage = await request.get('/api/billing/usage').set(auth(token));
  assert.equal(usage.status, 200);
  const ai = usage.body.data.find((u) => u.key === 'ai_requests');
  assert.equal(ai.limit, 2);
  assert.equal(ai.usage, 2);
  assert.equal(ai.remaining, 0);
});

// ---------------------------------------------------------------------------
// Monthly reset: usage is keyed by calendar month.
// ---------------------------------------------------------------------------

test('monthly usage resets across calendar months (service-level)', async () => {
  const { db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Reset Co', email: 'reset@b.test', password: 'Reset123!', roleKey: 'business_owner' });
  const plan = db
    .prepare(`INSERT INTO plans (key, name, user_limit, modules, price_monthly, sort_order, is_active, storage_limit_mb, export_enabled, api_enabled, license_duration_days, trial_days)
              VALUES ('reset_plan', 'Reset', -1, '["ai_assistant"]', 0, 0, 1, -1, 1, 1, 0, 0)`)
    .run();
  insertLicense(db, companyId, { planId: Number(plan.lastInsertRowid), status: 'active' });
  db.prepare('INSERT INTO plan_limits (plan_id, feature_key, limit_value) VALUES (?, ?, ?)').run(Number(plan.lastInsertRowid), 'ai_requests', 5);

  consumeUsage(db, companyId, 'ai_requests', { amount: 2, ref: '2026-08-15' });
  assert.equal(getFeatureUsage(db, companyId, 'ai_requests', '2026-08-15'), 2);
  assert.equal(getFeatureUsage(db, companyId, 'ai_requests', '2026-09-01'), 0, 'new month starts at zero');
  assert.equal(getFeatureLimit(db, companyId, 'ai_requests').limit, 5);
});

// ---------------------------------------------------------------------------
// Tenant isolation: one tenant's usage never affects another's quota.
// ---------------------------------------------------------------------------

test('tenant isolation: consuming one tenant quota does not affect another', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({
    key: 'iso_plan',
    name: 'Isolation Plan',
    modules: ['ai_assistant'],
    apiEnabled: true,
    limits: { ai_requests: 1 },
  });
  const planId = plan.body.data.id;

  const a = createCompanyAndUser(db, { companyName: 'Iso A', email: 'isoa@b.test', password: 'IsoA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Iso B', email: 'isob@b.test', password: 'IsoB123!', roleKey: 'business_owner' });
  insertLicense(db, a.companyId, { planId, status: 'active' });
  insertLicense(db, b.companyId, { planId, status: 'active' });

  const tokenA = await loginToken(request, 'isoa@b.test', 'IsoA123!');
  const tokenB = await loginToken(request, 'isob@b.test', 'IsoB123!');
  const q = { question: 'What were our sales this month?' };

  assert.equal((await request.post('/api/ai/ask').set(auth(tokenA)).send(q)).status, 200);
  const aExhausted = await request.post('/api/ai/ask').set(auth(tokenA)).send(q);
  assert.equal(aExhausted.status, 403, 'tenant A exhausted its own quota');

  assert.equal((await request.post('/api/ai/ask').set(auth(tokenB)).send(q)).status, 200, 'tenant B quota unaffected by tenant A');

  const usageB = await request.get('/api/billing/usage').set(auth(tokenB));
  const aiB = usageB.body.data.find((u) => u.key === 'ai_requests');
  assert.equal(aiB.usage, 1, 'tenant B sees only its own usage');

  const usageA = await request.get('/api/billing/usage').set(auth(tokenA));
  const aiA = usageA.body.data.find((u) => u.key === 'ai_requests');
  assert.equal(aiA.usage, 1, 'tenant A sees only its own usage');
});

test('non-super-admin cannot access Super Admin entitlement endpoints', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Peek Co', email: 'peek@b.test', password: 'Peek123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'peek@b.test', 'Peek123!');

  const ent = await request.get(`/api/admin/clients/${companyId}/entitlements`).set(auth(token));
  assert.equal(ent.status, 403);

  const usage = await request.get(`/api/admin/clients/${companyId}/usage`).set(auth(token));
  assert.equal(usage.status, 403);
});

// ---------------------------------------------------------------------------
// Subscription states: suspended/cancelled tenants are blocked regardless of limits.
// ---------------------------------------------------------------------------

test('cancelled subscription blocks feature access before limit checks', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Gone Co', email: 'gone@b.test', password: 'Gone123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'cancelled' });

  const token = await loginToken(request, 'gone@b.test', 'Gone123!');
  const res = await request.post('/api/leads').set(auth(token)).send({ companyName: 'Prospect X' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'LICENSE_CANCELLED');
});

// ---------------------------------------------------------------------------
// Effective entitlements: unified limits + usage view for Super Admin.
// ---------------------------------------------------------------------------

test('Super Admin usage endpoint reports limits and utilization', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({ key: 'util_plan', name: 'Util Plan', modules: ['leads'], limits: { leads: 2 } });
  const { companyId } = createCompanyAndUser(db, { companyName: 'Util Co', email: 'util@b.test', password: 'Util123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { planId: plan.body.data.id, status: 'active' });

  const token = await loginToken(request, 'util@b.test', 'Util123!');
  await request.post('/api/leads').set(auth(token)).send({ companyName: 'A' });

  const usage = await request.get(`/api/admin/clients/${companyId}/usage`).set(auth(admin));
  assert.equal(usage.status, 200);
  const leads = usage.body.data.find((u) => u.key === 'leads');
  assert.equal(leads.limit, 2);
  assert.equal(leads.usage, 1);
  assert.equal(leads.remaining, 1);
  assert.equal(leads.utilizationPct, 50);
});
