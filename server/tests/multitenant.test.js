import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function insertLicense(db, companyId, { status = 'active', planId = null, expiresAt = null, userLimit = null, modules = null, startsAt = null } = {}) {
  return Number(
    db
      .prepare(
        `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, user_limit, modules)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(companyId, planId, status, startsAt, expiresAt, userLimit, modules == null ? null : JSON.stringify(modules)).lastInsertRowid
  );
}

test('public /api/config returns seed company branding', async () => {
  const { request, seed } = initTestApp();
  const res = await request.get('/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.company.companyId, seed.companyId);
  assert.ok(res.body.data.brandColor);
  assert.ok(res.body.data.name);
});

test('super admin can manage clients, plans and licenses', async () => {
  const { request, db, seed } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const h = auth(admin);

  // Module catalog
  const mods = await request.get('/api/admin/modules').set(h);
  assert.equal(mods.status, 200);
  assert.ok(Array.isArray(mods.body.data.modules));

  // Create client
  const created = await request
    .post('/api/admin/clients')
    .set(h)
    .send({ name: 'Client X', brandColor: '#123456', domain: 'clientx.example.com' });
  assert.equal(created.status, 201);
  const clientId = created.body.data.id;

  // Update client branding
  const upd = await request
    .put(`/api/admin/clients/${clientId}`)
    .set(h)
    .send({ brandColor: '#abcdef', logoUrl: 'https://cdn/logo.png' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.data.brandColor, '#abcdef');

  // List clients includes license status
  const list = await request.get('/api/admin/clients').set(h);
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.total, 2);

  // Create plan
  const plan = await request
    .post('/api/admin/plans')
    .set(h)
    .send({ key: 'custom_pro', name: 'Custom Pro', userLimit: 10, modules: ['leads', 'customers'], priceMonthly: 25 });
  assert.equal(plan.status, 201);
  const planId = plan.body.data.id;

  // Upsert license for the client
  const lic = await request
    .put(`/api/admin/licenses/${clientId}`)
    .set(h)
    .send({ status: 'trial', planId, expiresAt: '2027-01-01', userLimit: 10, modules: ['leads', 'customers'] });
  assert.equal(lic.status, 200);
  assert.equal(lic.body.data.status, 'trial');
  assert.equal(lic.body.data.planId, planId);

  // License list
  const licList = await request.get('/api/admin/licenses').set(h);
  assert.equal(licList.status, 200);
  assert.ok(licList.body.data.some((l) => l.companyId === clientId));

  // Public config reflects the new client branding by companyId (super admin preview).
  const cfg = await request.get(`/api/config?companyId=${clientId}`).set(h);
  assert.equal(cfg.body.data.company.brandColor, '#abcdef');
});

test('non-super-admin cannot access admin routes', async () => {
  const { request, db, seed } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Beta Inc', email: 'bob@b.test', password: 'BobPass123!', roleKey: 'business_owner' });
  const bob = await loginToken(request, 'bob@b.test', 'BobPass123!');
  const res = await request.get('/api/admin/clients').set(auth(bob));
  assert.equal(res.status, 403);
});

test('suspended license blocks tenant access', async () => {
  const { request, db, seed } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Suspended Co', email: 'sus@b.test', password: 'SusPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'suspended' });

  const token = await loginToken(request, 'sus@b.test', 'SusPass123!');
  const me = await request.get('/api/auth/me').set(auth(token));
  assert.equal(me.status, 403);
  assert.equal(me.body.error.code, 'LICENSE_SUSPENDED');
});

test('expired license blocks tenant access and auto-transitions', async () => {
  const { request, db, seed } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Expired Co', email: 'exp@b.test', password: 'ExpPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { status: 'active', expiresAt: '2020-01-01' });

  const token = await loginToken(request, 'exp@b.test', 'ExpPass123!');
  const me = await request.get('/api/auth/me').set(auth(token));
  assert.equal(me.status, 403);
  assert.equal(me.body.error.code, 'LICENSE_EXPIRED');

  const row = db.prepare('SELECT status FROM licenses WHERE company_id = ?').get(companyId);
  assert.equal(row.status, 'expired');
});

test('module gating restricts tenant to enabled modules', async () => {
  const { request, db, seed } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Mods Co', email: 'mods@b.test', password: 'ModsPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { modules: ['leads'] });

  const token = await loginToken(request, 'mods@b.test', 'ModsPass123!');

  const leads = await request.get('/api/leads').set(auth(token));
  assert.equal(leads.status, 200);

  const customers = await request.get('/api/customers').set(auth(token));
  assert.equal(customers.status, 403);
  assert.equal(customers.body.error.code, 'MODULE_DISABLED');

  const dashboard = await request.get('/api/dashboard/summary').set(auth(token));
  assert.equal(dashboard.status, 403);
});

test('user limit is enforced on user creation', async () => {
  const { request, db, seed } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Limited Co', email: 'lim@b.test', password: 'LimPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { userLimit: 1 });

  const token = await loginToken(request, 'lim@b.test', 'LimPass123!');

  const res = await request
    .post('/api/users')
    .set(auth(token))
    .send({
      name: 'Second User',
      email: 'second@b.test',
      password: 'SecondPass123!',
      roleId: db.prepare("SELECT id FROM roles WHERE key = 'sales_executive'").get().id,
    });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'USER_LIMIT_REACHED');
});

test('no license = fully enabled (legacy self-hosted behaviour)', async () => {
  const { request, db, seed } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Legacy Co', email: 'legacy@b.test', password: 'LegacyPass123!', roleKey: 'business_owner' });

  const token = await loginToken(request, 'legacy@b.test', 'LegacyPass123!');
  const leads = await request.get('/api/leads').set(auth(token));
  assert.equal(leads.status, 200);
  const customers = await request.get('/api/customers').set(auth(token));
  assert.equal(customers.status, 200);
});
