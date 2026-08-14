import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser, addUserToCompany } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function insertLicense(db, companyId, { status = 'active', planId = null, expiresAt = null, userLimit = null, modules = null } = {}) {
  return Number(
    db
      .prepare(
        `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, user_limit, modules)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(companyId, planId, status, null, expiresAt, userLimit, modules == null ? null : JSON.stringify(modules)).lastInsertRowid
  );
}

async function inviteAndAccept(request, adminToken, companyId, email, password = 'WelcomePass123!') {
  const invite = await request
    .post(`/api/admin/clients/${companyId}/invite-admin`)
    .set(auth(adminToken))
    .send({ name: 'Company Admin', email });
  return { invite, accept: await request.post('/api/auth/accept-invite').send({ token: invite.body.data.invitationToken, password }) };
}

// ---------------------------------------------------------------------------
// Tenant creation & plan catalog
// ---------------------------------------------------------------------------

test('super admin can create a tenant with an industry', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const res = await request
    .post('/api/admin/clients')
    .set(auth(admin))
    .send({ name: 'Acme Manufacturing', industry: 'Manufacturing', domain: 'acme.example.com' });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.industry, 'Manufacturing');
  assert.equal(res.body.data.status, 'active');

  const fetched = await request.get(`/api/admin/clients/${res.body.data.id}`).set(auth(admin));
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.industry, 'Manufacturing');
});

test('plan catalog includes Basic, Professional, Enterprise and Custom', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const res = await request.get('/api/admin/plans').set(auth(admin));
  assert.equal(res.status, 200);
  const keys = res.body.data.map((p) => p.key);
  for (const k of ['basic', 'professional', 'enterprise', 'custom']) {
    assert.ok(keys.includes(k), `expected plan "${k}" in catalog`);
  }
});

test('client detail exposes plan, features and users', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Detail Co', email: 'detail@b.test', password: 'DetailPass123!', roleKey: 'business_owner' });

  const res = await request.get(`/api/admin/clients/${companyId}`).set(auth(admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.userCount, 1);
  assert.ok(Array.isArray(res.body.data.users));
  assert.ok(res.body.data.users.some((u) => u.email === 'detail@b.test'));
});

// ---------------------------------------------------------------------------
// Invitation & onboarding
// ---------------------------------------------------------------------------

test('super admin can invite a company admin and the invitee can set a password and log in', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Onboard Co', email: 'owner@b.test', password: 'OwnerPass123!', roleKey: 'business_owner' });

  const invite = await request
    .post(`/api/admin/clients/${companyId}/invite-admin`)
    .set(auth(admin))
    .send({ name: 'Company Admin', email: 'newadmin@b.test' });

  assert.equal(invite.status, 201);
  assert.ok(invite.body.data.invitationToken);
  assert.equal(invite.body.data.status, 'pending');

  const pending = db.prepare("SELECT status, company_id, role_id FROM users WHERE email = 'newadmin@b.test'").get();
  assert.equal(pending.status, 'pending');
  assert.equal(pending.company_id, companyId);

  const accept = await request.post('/api/auth/accept-invite').send({ token: invite.body.data.invitationToken, password: 'WelcomePass123!' });
  assert.equal(accept.status, 200);
  assert.ok(accept.body.data.token);
  assert.equal(accept.body.data.user.email, 'newadmin@b.test');
  assert.equal(accept.body.data.user.roleKey, 'business_owner');

  // The invitee can now log in normally with the password they chose.
  const login = await request.post('/api/auth/login').send({ email: 'newadmin@b.test', password: 'WelcomePass123!' });
  assert.equal(login.status, 200);

  // The token is single-use: a second attempt fails.
  const reuse = await request.post('/api/auth/accept-invite').send({ token: invite.body.data.invitationToken, password: 'OtherPass123!' });
  assert.equal(reuse.status, 400);
});

test('accepting an invalid invitation is rejected', async () => {
  const { request } = initTestApp();
  const res = await request.post('/api/auth/accept-invite').send({ token: '0000000000000000deadbeefdeadbeef', password: 'WhateverPass123!' });
  assert.equal(res.status, 400);
});

test('expired invitation is rejected', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Expire Co', email: 'owner@b.test', password: 'OwnerPass123!', roleKey: 'business_owner' });

  const invite = await request
    .post(`/api/admin/clients/${companyId}/invite-admin`)
    .set(auth(admin))
    .send({ name: 'Company Admin', email: 'expired@b.test' });
  assert.equal(invite.status, 201);

  db.prepare("UPDATE users SET invitation_expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'expired@b.test'").run();

  const accept = await request.post('/api/auth/accept-invite').send({ token: invite.body.data.invitationToken, password: 'WelcomePass123!' });
  assert.equal(accept.status, 400);
});

test('re-inviting resets access and issues a fresh token', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Reset Co', email: 'owner@b.test', password: 'OwnerPass123!', roleKey: 'business_owner' });

  const first = await request
    .post(`/api/admin/clients/${companyId}/invite-admin`)
    .set(auth(admin))
    .send({ name: 'Company Admin', email: 'reset@b.test' });
  assert.equal(first.status, 201);

  const second = await request
    .post(`/api/admin/clients/${companyId}/invite-admin`)
    .set(auth(admin))
    .send({ name: 'Company Admin', email: 'reset@b.test' });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.reset, true);
  assert.notEqual(second.body.data.invitationToken, first.body.data.invitationToken);

  // First token is now invalidated.
  const stale = await request.post('/api/auth/accept-invite').send({ token: first.body.data.invitationToken, password: 'WelcomePass123!' });
  assert.equal(stale.status, 400);

  const fresh = await request.post('/api/auth/accept-invite').send({ token: second.body.data.invitationToken, password: 'WelcomePass123!' });
  assert.equal(fresh.status, 200);
});

test('invitation enforces the tenant user limit', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Limit Co', email: 'owner@b.test', password: 'OwnerPass123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { userLimit: 1 });

  const res = await request
    .post(`/api/admin/clients/${companyId}/invite-admin`)
    .set(auth(admin))
    .send({ name: 'Second Admin', email: 'second@b.test' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'USER_LIMIT_REACHED');
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

test('non-super-admin cannot invite a company admin', async () => {
  const { request, db, seed } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Rogue Co', email: 'rogue@b.test', password: 'RoguePass123!', roleKey: 'business_owner' });
  const rogue = await loginToken(request, 'rogue@b.test', 'RoguePass123!');

  const res = await request
    .post(`/api/admin/clients/${seed.companyId}/invite-admin`)
    .set(auth(rogue))
    .send({ name: 'X', email: 'x@b.test' });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Isolation & direct API access
// ---------------------------------------------------------------------------

test('a newly onboarded admin cannot see another tenant data', async () => {
  const { request, db, seed } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  // A user in the seed company (tenant A) that Tenant B must never see.
  addUserToCompany(db, seed.companyId, { name: 'Alice Owner', email: 'alice@a.test', password: 'AlicePass123!', roleKey: 'business_owner' });
  const { companyId } = createCompanyAndUser(db, { companyName: 'Tenant B', email: 'owner@b.test', password: 'OwnerPass123!', roleKey: 'business_owner' });

  const { accept } = await inviteAndAccept(request, admin, companyId, 'adminb@b.test');
  const adminBToken = accept.body.data.token;

  const seedUsers = db.prepare('SELECT id FROM users WHERE company_id = ?').all(seed.companyId);
  assert.ok(seedUsers.length > 0);

  const list = await request.get('/api/users').set(auth(adminBToken));
  assert.equal(list.status, 200);
  const emails = list.body.data.map((u) => u.email);
  assert.ok(emails.includes('adminb@b.test'));
  assert.ok(!emails.includes('alice@a.test'));
  assert.ok(!emails.includes('admin@test.com'));

  // Direct record access to a foreign user id is denied.
  const foreign = seedUsers[0].id;
  const get = await request.get(`/api/users/${foreign}`).set(auth(adminBToken));
  assert.equal(get.status, 403);
});

test('tenant admin cannot inject another companyId when creating data', async () => {
  const { request, db, seed } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Tenant B', email: 'owner@b.test', password: 'OwnerPass123!', roleKey: 'business_owner' });

  const { accept } = await inviteAndAccept(request, admin, companyId, 'adminb@b.test');
  const adminBToken = accept.body.data.token;

  const res = await request
    .post('/api/leads')
    .set(auth(adminBToken))
    .send({ companyName: 'Injected Lead', email: 'lead@b.test', companyId: seed.companyId });
  assert.equal(res.status, 201);

  const row = db.prepare('SELECT company_id FROM leads WHERE id = ?').get(res.body.data.id);
  assert.equal(row.company_id, companyId);
  assert.notEqual(row.company_id, seed.companyId);
});

// ---------------------------------------------------------------------------
// Activation / deactivation
// ---------------------------------------------------------------------------

test('suspending a tenant blocks its users and reactivating restores access', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Suspend Co', email: 'owner@b.test', password: 'OwnerPass123!', roleKey: 'business_owner' });
  const ownerToken = await loginToken(request, 'owner@b.test', 'OwnerPass123!');

  const before = await request.get('/api/auth/me').set(auth(ownerToken));
  assert.equal(before.status, 200);

  const suspend = await request.put(`/api/admin/clients/${companyId}`).set(auth(admin)).send({ status: 'suspended' });
  assert.equal(suspend.status, 200);
  assert.equal(suspend.body.data.status, 'suspended');

  const blocked = await request.get('/api/auth/me').set(auth(ownerToken));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'TENANT_SUSPENDED');

  const reactivate = await request.put(`/api/admin/clients/${companyId}`).set(auth(admin)).send({ status: 'active' });
  assert.equal(reactivate.status, 200);

  const restored = await request.get('/api/auth/me').set(auth(ownerToken));
  assert.equal(restored.status, 200);
});

test('deactivating a tenant blocks its users', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Inactive Co', email: 'owner@b.test', password: 'OwnerPass123!', roleKey: 'business_owner' });
  const ownerToken = await loginToken(request, 'owner@b.test', 'OwnerPass123!');

  const deactivate = await request.put(`/api/admin/clients/${companyId}`).set(auth(admin)).send({ status: 'inactive' });
  assert.equal(deactivate.status, 200);

  const blocked = await request.get('/api/auth/me').set(auth(ownerToken));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'TENANT_INACTIVE');
});
