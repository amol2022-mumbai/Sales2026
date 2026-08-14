import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function daysFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

function insertPlan(
  db,
  {
    key,
    name = 'Plan',
    userLimit = -1,
    modules = null,
    exportEnabled = true,
    apiEnabled = false,
    storageLimitMb = -1,
    licenseDurationDays = 0,
    trialDays = 0,
  }
) {
  return Number(
    db
      .prepare(
        `INSERT INTO plans (key, name, user_limit, modules, price_monthly, sort_order, is_active, storage_limit_mb, export_enabled, api_enabled, license_duration_days, trial_days)
         VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?, ?, ?, ?)`
      )
      .run(
        key,
        name,
        userLimit,
        modules == null ? null : JSON.stringify(modules),
        storageLimitMb,
        exportEnabled ? 1 : 0,
        apiEnabled ? 1 : 0,
        licenseDurationDays,
        trialDays
      ).lastInsertRowid
  );
}

function insertLicense(
  db,
  companyId,
  { status = 'active', planId = null, expiresAt = null, userLimit = null, modules = null, storageLimitMb = null, exportEnabled = null, apiEnabled = null } = {}
) {
  return Number(
    db
      .prepare(
        `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, user_limit, modules, storage_limit_mb, export_enabled, api_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyId,
        planId,
        status,
        null,
        expiresAt,
        userLimit,
        modules == null ? null : JSON.stringify(modules),
        storageLimitMb,
        exportEnabled,
        apiEnabled
      ).lastInsertRowid
  );
}

function updateLicense(db, companyId, fields) {
  const sets = [];
  const values = [];
  const map = {
    status: 'status',
    expiresAt: 'expires_at',
    exportEnabled: 'export_enabled',
    apiEnabled: 'api_enabled',
    storageLimitMb: 'storage_limit_mb',
  };
  for (const [input, column] of Object.entries(map)) {
    if (input in fields) {
      sets.push(`${column} = ?`);
      values.push(fields[input]);
    }
  }
  values.push(companyId);
  db.prepare(`UPDATE licenses SET ${sets.join(', ')} WHERE company_id = ?`).run(...values);
}

// ---------------------------------------------------------------------------
// Plan entitlements
// ---------------------------------------------------------------------------

test('plan entitlements (storage, export, api, duration, trial) persist and round-trip', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({
    key: 'pro_ent',
    name: 'Pro Entitlements',
    userLimit: 25,
    storageLimitMb: 5120,
    exportEnabled: false,
    apiEnabled: true,
    licenseDurationDays: 365,
    trialDays: 14,
    modules: ['leads', 'reports'],
  });
  assert.equal(plan.status, 201);
  assert.equal(plan.body.data.storageLimitMb, 5120);
  assert.equal(plan.body.data.exportEnabled, false);
  assert.equal(plan.body.data.apiEnabled, true);
  assert.equal(plan.body.data.licenseDurationDays, 365);
  assert.equal(plan.body.data.trialDays, 14);

  const list = await request.get('/api/admin/plans').set(auth(admin));
  const found = list.body.data.find((p) => p.key === 'pro_ent');
  assert.equal(found.exportEnabled, false);
  assert.equal(found.apiEnabled, true);
});

// ---------------------------------------------------------------------------
// Export entitlement
// ---------------------------------------------------------------------------

test('export entitlement is enforced from the plan and overridable per license', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Export Co', email: 'exp@b.test', password: 'ExpPass123!', roleKey: 'business_owner' });
  const planId = insertPlan(db, { key: 'no_export', name: 'No Export', exportEnabled: false, modules: ['leads'] });
  insertLicense(db, companyId, { planId, status: 'active' });

  const token = await loginToken(request, 'exp@b.test', 'ExpPass123!');

  const list = await request.get('/api/leads').set(auth(token));
  assert.equal(list.status, 200, 'module access still works');

  const blocked = await request.get('/api/leads/export').set(auth(token));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'EXPORT_DISABLED');

  // A per-license override re-enables export.
  updateLicense(db, companyId, { exportEnabled: 1 });
  const allowed = await request.get('/api/leads/export').set(auth(token));
  assert.equal(allowed.status, 200);
});

// ---------------------------------------------------------------------------
// API / integration entitlement (AI provider integration surface)
// ---------------------------------------------------------------------------

test('api/integration entitlement blocks the AI assistant unless enabled', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Api Co', email: 'api@b.test', password: 'ApiPass123!', roleKey: 'business_owner' });
  const planId = insertPlan(db, { key: 'no_api', name: 'No API', apiEnabled: false, modules: ['ai_assistant'] });
  insertLicense(db, companyId, { planId, status: 'active' });

  const token = await loginToken(request, 'api@b.test', 'ApiPass123!');

  const blocked = await request.post('/api/ai/ask').set(auth(token)).send({ question: 'What were our sales?' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'API_ACCESS_DISABLED');

  updateLicense(db, companyId, { apiEnabled: 1 });
  const allowed = await request.post('/api/ai/ask').set(auth(token)).send({ question: 'What were our sales?' });
  assert.equal(allowed.status, 200);
});

// ---------------------------------------------------------------------------
// Lifecycle states
// ---------------------------------------------------------------------------

test('cancelled license blocks tenant access', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Cancelled Co', email: 'can@b.test', password: 'CanPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'cancelled' });

  const token = await loginToken(request, 'can@b.test', 'CanPass123!');
  const me = await request.get('/api/auth/me').set(auth(token));
  assert.equal(me.status, 403);
  assert.equal(me.body.error.code, 'LICENSE_CANCELLED');
});

test('active license nearing expiry is reported as expiring', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Expiring Co', email: 'soon@b.test', password: 'SoonPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'active', expiresAt: daysFromNow(10) });

  const token = await loginToken(request, 'soon@b.test', 'SoonPass123!');
  const me = await request.get('/api/auth/me').set(auth(token));
  assert.equal(me.status, 200);
  assert.equal(me.body.data.tenant.license.status, 'expiring');
});

// ---------------------------------------------------------------------------
// Trial period & license duration defaults
// ---------------------------------------------------------------------------

test('trial license derives its expiry from the plan trial period', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({ key: 'trial_plan', name: 'Trial Plan', trialDays: 14 });
  const planId = plan.body.data.id;

  const client = await request.post('/api/admin/clients').set(auth(admin)).send({ name: 'Trial Tenant' });
  const clientId = client.body.data.id;

  const lic = await request.put(`/api/admin/licenses/${clientId}`).set(auth(admin)).send({ status: 'trial', planId });
  assert.equal(lic.status, 200);
  assert.equal(lic.body.data.expiresAt, daysFromNow(14));
});

test('active license derives its expiry from the plan license duration', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const plan = await request.post('/api/admin/plans').set(auth(admin)).send({ key: 'annual_plan', name: 'Annual Plan', licenseDurationDays: 30 });
  const planId = plan.body.data.id;

  const client = await request.post('/api/admin/clients').set(auth(admin)).send({ name: 'Annual Tenant' });
  const clientId = client.body.data.id;

  const lic = await request.put(`/api/admin/licenses/${clientId}`).set(auth(admin)).send({ status: 'active', planId });
  assert.equal(lic.status, 200);
  assert.equal(lic.body.data.expiresAt, daysFromNow(30));
});

// ---------------------------------------------------------------------------
// Tenant payload & admin visibility
// ---------------------------------------------------------------------------

test('tenant payload exposes storage, export and api entitlements', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Entitle Co', email: 'ent@b.test', password: 'EntPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { storageLimitMb: 2048, exportEnabled: 0, apiEnabled: 1 });

  const token = await loginToken(request, 'ent@b.test', 'EntPass123!');
  const me = await request.get('/api/auth/me').set(auth(token));
  const lic = me.body.data.tenant.license;
  assert.equal(lic.storageLimitMb, 2048);
  assert.equal(lic.exportEnabled, false);
  assert.equal(lic.apiEnabled, true);
});

test('admin clients list exposes per-tenant entitlements', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Admin Ent Co', email: 'aent@b.test', password: 'AentPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { storageLimitMb: 4096, exportEnabled: 0, apiEnabled: 1 });
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const list = await request.get('/api/admin/clients').set(auth(admin));
  const client = list.body.data.find((c) => c.id === companyId);
  assert.equal(client.storageLimitMb, 4096);
  assert.equal(client.exportEnabled, false);
  assert.equal(client.apiEnabled, true);
});
