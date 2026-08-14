import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function grantPermission(db, roleKey, permissionKey) {
  const role = db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey);
  const perm = db.prepare('SELECT id FROM permissions WHERE key = ?').get(permissionKey);
  db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(role.id, perm.id);
}

test('cross-tenant lead access is denied', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Alpha Co', email: 'alpha@b.test', password: 'AlphaPass123!', roleKey: 'business_owner' });
  createCompanyAndUser(db, { companyName: 'Beta Co', email: 'beta@b.test', password: 'BetaPass123!', roleKey: 'business_owner' });

  const alpha = await loginToken(request, 'alpha@b.test', 'AlphaPass123!');
  const beta = await loginToken(request, 'beta@b.test', 'BetaPass123!');

  const created = await request
    .post('/api/leads')
    .set(auth(alpha))
    .send({ companyName: 'Alpha Private Lead', email: 'private@alpha.test' });
  assert.equal(created.status, 201);
  const leadId = created.body.data.id;

  // Beta cannot read Alpha's lead by id.
  const get = await request.get(`/api/leads/${leadId}`).set(auth(beta));
  assert.equal(get.status, 403);

  // Beta's list does not contain Alpha's lead.
  const list = await request.get('/api/leads').set(auth(beta));
  assert.equal(list.status, 200);
  assert.ok(!list.body.data.some((l) => l.id === leadId));
});

test('cross-tenant customer access is denied', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Alpha Co', email: 'alpha@b.test', password: 'AlphaPass123!', roleKey: 'business_owner' });
  createCompanyAndUser(db, { companyName: 'Beta Co', email: 'beta@b.test', password: 'BetaPass123!', roleKey: 'business_owner' });

  const alpha = await loginToken(request, 'alpha@b.test', 'AlphaPass123!');
  const beta = await loginToken(request, 'beta@b.test', 'BetaPass123!');

  const created = await request
    .post('/api/customers')
    .set(auth(alpha))
    .send({ name: 'Alpha Private Customer', email: 'cust@alpha.test' });
  assert.equal(created.status, 201);
  const customerId = created.body.data.id;

  const get = await request.get(`/api/customers/${customerId}`).set(auth(beta));
  assert.equal(get.status, 403);

  const list = await request.get('/api/customers').set(auth(beta));
  assert.equal(list.status, 200);
  assert.ok(!list.body.data.some((c) => c.id === customerId));
});

test('non-super-admin cannot set companyId to another tenant on create', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Alpha Co', email: 'alpha@b.test', password: 'AlphaPass123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Beta Co', email: 'beta@b.test', password: 'BetaPass123!', roleKey: 'business_owner' });

  const alpha = await loginToken(request, 'alpha@b.test', 'AlphaPass123!');

  const res = await request
    .post('/api/leads')
    .set(auth(alpha))
    .send({ companyName: 'Trying to inject into Beta', email: 'inject@alpha.test', companyId: b.companyId });
  assert.equal(res.status, 201);

  const row = db.prepare('SELECT company_id FROM leads WHERE id = ?').get(res.body.data.id);
  assert.equal(row.company_id, a.companyId);
  assert.notEqual(row.company_id, b.companyId);
});

test('role permission editing is super-admin-only', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Alpha Co', email: 'alpha@b.test', password: 'AlphaPass123!', roleKey: 'business_owner' });

  // Grant the business_owner the roles:manage permission directly, to prove the
  // super-admin guard (not just the permission check) protects this route.
  grantPermission(db, 'business_owner', 'roles:manage');

  const alpha = await loginToken(request, 'alpha@b.test', 'AlphaPass123!');
  const targetRole = db.prepare("SELECT id FROM roles WHERE key = 'sales_executive'").get();

  const denied = await request
    .put(`/api/roles/${targetRole.id}/permissions`)
    .set(auth(alpha))
    .send({ permissionKeys: ['leads:view'] });
  assert.equal(denied.status, 403);

  const admin = await loginToken(request, process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD);
  const allowed = await request
    .put(`/api/roles/${targetRole.id}/permissions`)
    .set(auth(admin))
    .send({ permissionKeys: ['leads:view', 'leads:create'] });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.data.permissions.length, 2);
});

test('super admin role cannot be edited', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD);
  const superRole = db.prepare("SELECT id FROM roles WHERE key = 'super_admin'").get();

  const res = await request
    .put(`/api/roles/${superRole.id}/permissions`)
    .set(auth(admin))
    .send({ permissionKeys: [] });
  assert.equal(res.status, 400);
});

test('failed login is written to the audit log', async () => {
  const { request, db } = initTestApp();

  await request.post('/api/auth/login').send({ email: 'nobody@nowhere.test', password: 'WrongPass123!' });
  await request.post('/api/auth/login').send({ email: process.env.SEED_ADMIN_EMAIL, password: 'WrongPass123!' });

  const failed = db
    .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'auth.login_failed'")
    .get().c;
  assert.ok(failed >= 2, `expected at least 2 failed-login audit entries, got ${failed}`);
});

test('imports are capped at the maximum row count', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Alpha Co', email: 'alpha@b.test', password: 'AlphaPass123!', roleKey: 'business_owner' });
  const alpha = await loginToken(request, 'alpha@b.test', 'AlphaPass123!');

  // Header + 10001 data rows.
  const lines = ['Company,Email'];
  for (let i = 0; i < 10001; i += 1) lines.push(`Company ${i},u${i}@example.com`);
  const csv = lines.join('\n');

  const res = await request
    .post('/api/leads/import')
    .set(auth(alpha))
    .send({ format: 'csv', data: Buffer.from(csv).toString('base64') });
  assert.equal(res.status, 400);
});

test('tampered or foreign-signed token is rejected', async () => {
  const { request, db } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Alpha Co', email: 'alpha@b.test', password: 'AlphaPass123!', roleKey: 'business_owner' });
  const alpha = await loginToken(request, 'alpha@b.test', 'AlphaPass123!');

  // Corrupt the signature of an otherwise-valid token.
  const parts = alpha.split('.');
  parts[2] = parts[2].split('').reverse().join('');
  const tampered = parts.join('.');

  const res = await request.get('/api/auth/me').set(auth(tampered));
  assert.equal(res.status, 401);
});
