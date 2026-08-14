import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser, addUserToCompany } from './helpers.js';

async function setupRoles() {
  const { request, db, seed } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'Acme Sales',
    email: 'owner@acme.test',
    password: 'OwnerPass123!',
    roleKey: 'business_owner',
  });
  addUserToCompany(db, companyId, {
    name: 'Viewer',
    email: 'viewer@acme.test',
    password: 'ViewerPass123!',
    roleKey: 'viewer',
  });
  addUserToCompany(db, companyId, {
    name: 'Executive',
    email: 'exec@acme.test',
    password: 'ExecPass123!',
    roleKey: 'sales_executive',
  });

  const ownerToken = await loginToken(request, 'owner@acme.test', 'OwnerPass123!');
  const viewerToken = await loginToken(request, 'viewer@acme.test', 'ViewerPass123!');
  const execToken = await loginToken(request, 'exec@acme.test', 'ExecPass123!');

  return { request, db, ownerToken, viewerToken, execToken, companyId, adminEmail: seed.adminEmail };
}

test('viewer is read-only: can list users but cannot create or edit them', async () => {
  const { request, viewerToken } = await setupRoles();

  const dash = await request.get('/api/dashboard/summary').set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(dash.status, 200);

  const users = await request.get('/api/users').set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(users.status, 200);

  const create = await request
    .post('/api/users')
    .set('Authorization', `Bearer ${viewerToken}`)
    .send({ name: 'X', email: 'x@acme.test', password: 'Password123!', roleId: 5 });
  assert.equal(create.status, 403);

  const audit = await request.get('/api/audit-logs').set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(audit.status, 403);
});

test('sales executive cannot access audit logs or user management', async () => {
  const { request, execToken } = await setupRoles();

  const dash = await request.get('/api/dashboard/summary').set('Authorization', `Bearer ${execToken}`);
  assert.equal(dash.status, 200);

  const audit = await request.get('/api/audit-logs').set('Authorization', `Bearer ${execToken}`);
  assert.equal(audit.status, 403);

  const create = await request
    .post('/api/users')
    .set('Authorization', `Bearer ${execToken}`)
    .send({ name: 'X', email: 'x@acme.test', password: 'Password123!', roleId: 1 });
  assert.equal(create.status, 403);
});

test('business owner can view and edit their company settings', async () => {
  const { request, ownerToken, companyId } = await setupRoles();

  const list = await request.get('/api/companies').set('Authorization', `Bearer ${ownerToken}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].id, companyId);

  const update = await request
    .put(`/api/companies/${companyId}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'Acme Sales Updated', currency: 'EUR' });
  assert.equal(update.status, 200);
  assert.equal(update.body.data.name, 'Acme Sales Updated');
  assert.equal(update.body.data.currency, 'EUR');
});

test('business owner cannot manage users of the super admin scope (no super admin role)', async () => {
  const { request, ownerToken } = await setupRoles();
  const res = await request
    .post('/api/users')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'X', email: 'x@acme.test', password: 'Password123!', roleId: 1 });
  // roleId 1 is super_admin -> forbidden even for business owner
  assert.equal(res.status, 403);
});

test('non-super-admin cannot list roles that include super_admin', async () => {
  const { request, ownerToken } = await setupRoles();
  const res = await request.get('/api/roles').set('Authorization', `Bearer ${ownerToken}`);
  assert.equal(res.status, 200);
  const keys = res.body.data.map((r) => r.key);
  assert.ok(!keys.includes('super_admin'));
  assert.ok(keys.includes('sales_executive'));
});
