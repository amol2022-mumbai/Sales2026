import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser, createUserInCompany } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function pad(n) {
  return String(n).padStart(2, '0');
}

function today() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function daysFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function daysAgo(days) {
  return daysFromNow(-days);
}

function insertLicense(db, companyId, { status = 'active', planId = null, expiresAt = null, userLimit = null } = {}) {
  return Number(
    db
      .prepare(
        `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, user_limit)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(companyId, planId, status, daysAgo(30), expiresAt, userLimit).lastInsertRowid
  );
}

async function getPlanId(request, admin, key) {
  const res = await request.get('/api/admin/plans').set(auth(admin));
  const plan = res.body.data.find((p) => p.key === key);
  assert.ok(plan, `expected seeded plan "${key}"`);
  return plan.id;
}

// ---------------------------------------------------------------------------
// Operations overview
// ---------------------------------------------------------------------------

test('super admin can fetch the operations overview with real-data sections', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const planId = await getPlanId(request, admin, 'professional');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Ops Co', email: 'ops@o.test', password: 'OpsPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'trial', planId, expiresAt: daysFromNow(60) });
  const { companyId: expiringId } = createCompanyAndUser(db, { companyName: 'Ops Expiring Co', email: 'opsexp@o.test', password: 'OpsExp123!', roleKey: 'business_owner' });
  insertLicense(db, expiringId, { status: 'active', planId, expiresAt: daysFromNow(10) });

  const res = await request.get('/api/admin/operations').set(auth(admin));
  assert.equal(res.status, 200);
  const d = res.body.data;

  assert.equal(typeof d.totals.tenants.total, 'number');
  assert.ok(d.totals.tenants.total >= 3);
  assert.ok(d.totals.tenants.trial >= 1, 'trial lifecycle tenant expected');
  assert.ok(d.totals.tenants.expiring >= 1, 'expiring lifecycle tenant expected');
  assert.equal(typeof d.totals.newTenants30d, 'number');
  assert.equal(typeof d.totals.users.total, 'number');
  assert.ok(d.totals.licenses.expiringSoon >= 1, 'license expiring within 30 days should count as expiring soon');
  assert.equal(typeof d.totals.plans.monthly, 'number');
  assert.equal(typeof d.totals.subscription.mrr, 'number');
  assert.equal(typeof d.totals.subscription.arr, 'number');
  assert.equal(typeof d.totals.payments.paid, 'number');
  assert.equal(typeof d.totals.trialConversion.converted, 'number');
  assert.equal(typeof d.health.failedWebhookEvents, 'number');
  assert.equal(typeof d.security.events24h, 'number');
  assert.ok(Array.isArray(d.security.recent));
  assert.ok(Array.isArray(d.activity));
});

test('non-super-admin cannot access operations endpoints', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Ops Rogue', email: 'rogue@o.test', password: 'RoguePass123!', roleKey: 'business_owner' });
  const rogue = await loginToken(request, 'rogue@o.test', 'RoguePass123!');

  for (const path of ['/api/admin/operations', '/api/admin/operations/alerts', '/api/admin/operations/tenants/1']) {
    const res = await request.get(path).set(auth(rogue));
    assert.equal(res.status, 403, `${path} should be forbidden for non-super-admin`);
  }
});

// ---------------------------------------------------------------------------
// Tenant overview
// ---------------------------------------------------------------------------

test('tenant overview aggregates plan, license, subscription, users, usage and activity', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const planId = await getPlanId(request, admin, 'basic');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Overview Co', email: 'ov@o.test', password: 'OvPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'active', planId, userLimit: 5, expiresAt: daysFromNow(90) });

  const res = await request.get(`/api/admin/operations/tenants/${companyId}`).set(auth(admin));
  assert.equal(res.status, 200);
  const d = res.body.data;

  assert.equal(d.id, companyId);
  assert.equal(d.name, 'Overview Co');
  assert.equal(d.licenseStatus, 'active');
  assert.equal(d.lifecycle, 'active');
  assert.equal(d.plan.key, 'basic');
  assert.equal(d.userLimit, 5);
  assert.equal(d.userCount, 1);
  assert.ok(Array.isArray(d.users));
  assert.ok(Array.isArray(d.enabledFeatures));
  assert.equal(typeof d.billing.outstanding, 'number');
  assert.equal(typeof d.usage.leadCount, 'number');
  assert.ok(Array.isArray(d.invoices));
  assert.ok(Array.isArray(d.payments));
  assert.ok(Array.isArray(d.activity));
});

test('tenant overview returns 404 for an unknown company', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const res = await request.get('/api/admin/operations/tenants/999999').set(auth(admin));
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

test('alerts surface expiring, expired, overdue, failed, near-limit and suspended tenants', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const planId = await getPlanId(request, admin, 'professional');

  // Expiring tenant.
  const { companyId: expiringId } = createCompanyAndUser(db, { companyName: 'Expiring Co', email: 'exp@o.test', password: 'ExpPass123!', roleKey: 'business_owner' });
  insertLicense(db, expiringId, { status: 'active', planId, expiresAt: daysFromNow(10) });

  // Expired tenant.
  const { companyId: expiredId } = createCompanyAndUser(db, { companyName: 'Expired Co', email: 'exd@o.test', password: 'ExdPass123!', roleKey: 'business_owner' });
  insertLicense(db, expiredId, { status: 'active', planId, expiresAt: daysAgo(5) });

  // Overdue + failed payment tenant.
  const { companyId: overdueId } = createCompanyAndUser(db, { companyName: 'Overdue Co', email: 'ovd@o.test', password: 'OvdPass123!', roleKey: 'business_owner' });
  insertLicense(db, overdueId, { status: 'active', planId });
  db.prepare(
    `INSERT INTO subscription_invoices (company_id, plan_id, amount, due_date, status)
     VALUES (?, ?, 99, ?, 'Unpaid')`
  ).run(overdueId, planId, daysAgo(3));
  db.prepare(
    `INSERT INTO subscription_events (provider, provider_event_id, event_type, company_id)
     VALUES ('stripe', 'evt_failed_1', 'invoice.payment_failed', ?)`
  ).run(overdueId);

  // Near-limit tenant.
  const { companyId: nearLimitId } = createCompanyAndUser(db, { companyName: 'Near Limit Co', email: 'nl@o.test', password: 'NlPass123!', roleKey: 'business_owner' });
  insertLicense(db, nearLimitId, { status: 'active', planId, userLimit: 5 });
  for (let i = 0; i < 4; i += 1) {
    createUserInCompany(db, nearLimitId, { name: `User ${i}`, email: `user${i}@nl.test`, password: 'NlUser123!', roleKey: 'sales_executive' });
  }

  // Suspended tenant.
  const { companyId: suspendedId } = createCompanyAndUser(db, { companyName: 'Suspended Co', email: 'sus@o.test', password: 'SusPass123!', roleKey: 'business_owner' });
  insertLicense(db, suspendedId, { status: 'suspended', planId });

  // Security event.
  db.prepare(
    `INSERT INTO audit_logs (company_id, action, metadata) VALUES (?, 'auth.login_failed', '{"email":"bad@o.test"}')`
  ).run(suspendedId);

  const res = await request.get('/api/admin/operations/alerts').set(auth(admin));
  assert.equal(res.status, 200);
  const items = res.body.data;
  const byId = new Map(items.map((a) => [a.id, a]));

  assert.ok(byId.get(`license_expiring:${expiringId}`), 'expiring license alert expected');
  assert.ok(byId.get(`license_expired:${expiredId}`), 'expired license alert expected');
  assert.ok(byId.get(`payment_overdue:${overdueId}`), 'overdue payment alert expected');
  assert.ok(byId.get(`payment_failed:${overdueId}`), 'failed payment alert expected');
  assert.ok(byId.get(`user_near_limit:${nearLimitId}`), 'near-limit alert expected');
  assert.ok(byId.get(`tenant_suspended:${suspendedId}`), 'suspended tenant alert expected');
  assert.ok(items.some((a) => a.type === 'security'), 'security alert expected');
});

test('alerts can be filtered by type and severity', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Alert Co', email: 'al@o.test', password: 'AlPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'active', expiresAt: daysAgo(5) });

  const byType = await request.get('/api/admin/operations/alerts?type=license_expired').set(auth(admin));
  assert.equal(byType.status, 200);
  assert.ok(byType.body.data.every((a) => a.type === 'license_expired'));

  const bySeverity = await request.get('/api/admin/operations/alerts?severity=critical').set(auth(admin));
  assert.equal(bySeverity.status, 200);
  assert.ok(bySeverity.body.data.length > 0);
  assert.ok(bySeverity.body.data.every((a) => a.severity === 'critical'));
});

// ---------------------------------------------------------------------------
// Enhanced client list (filters / sort)
// ---------------------------------------------------------------------------

test('client list supports lifecycle, licenseStatus, plan and sort filters', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const planId = await getPlanId(request, admin, 'professional');

  const { companyId: pendingId } = createCompanyAndUser(db, { companyName: 'Pending Co', email: 'pnd@o.test', password: 'PndPass123!', roleKey: 'business_owner' });
  const { companyId: activeId } = createCompanyAndUser(db, { companyName: 'Active Co', email: 'act@o.test', password: 'ActPass123!', roleKey: 'business_owner' });
  insertLicense(db, activeId, { status: 'active', planId, expiresAt: daysFromNow(90) });

  const byLifecycle = await request.get('/api/admin/clients?lifecycle=pending').set(auth(admin));
  assert.equal(byLifecycle.status, 200);
  assert.ok(byLifecycle.body.data.every((c) => c.lifecycleStatus === 'pending'));
  assert.ok(byLifecycle.body.data.some((c) => c.id === pendingId));

  const byLicense = await request.get('/api/admin/clients?licenseStatus=active').set(auth(admin));
  assert.equal(byLicense.status, 200);
  assert.ok(byLicense.body.data.some((c) => c.id === activeId));

  const byPlan = await request.get(`/api/admin/clients?planId=${planId}`).set(auth(admin));
  assert.equal(byPlan.status, 200);
  assert.ok(byPlan.body.data.every((c) => c.planId === planId));

  const sorted = await request.get('/api/admin/clients?sort=name&order=asc').set(auth(admin));
  assert.equal(sorted.status, 200);
  const names = sorted.body.data.map((c) => c.name);
  assert.deepEqual(names, [...names].sort());
});
