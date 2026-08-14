import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser, addUserToCompany } from './helpers.js';

test('users list is scoped to the requesting company', async () => {
  const { request, db, seed } = initTestApp();

  // User in the seeded company (company A).
  addUserToCompany(db, seed.companyId, {
    name: 'Alice Owner',
    email: 'alice@a.test',
    password: 'AlicePass123!',
    roleKey: 'business_owner',
  });

  // Company B with its own user.
  const b = createCompanyAndUser(db, {
    companyName: 'Beta Inc',
    email: 'bob@b.test',
    password: 'BobPass123!',
    roleKey: 'business_owner',
  });

  const aliceToken = await loginToken(request, 'alice@a.test', 'AlicePass123!');

  const res = await request.get('/api/users').set('Authorization', `Bearer ${aliceToken}`);
  assert.equal(res.status, 200);
  const emails = res.body.data.map((u) => u.email);
  assert.ok(emails.includes('alice@a.test'));
  assert.ok(!emails.includes('bob@b.test'));
});

test('cannot read another company detail', async () => {
  const { request, db, seed } = initTestApp();
  addUserToCompany(db, seed.companyId, {
    name: 'Alice Owner',
    email: 'alice@a.test',
    password: 'AlicePass123!',
    roleKey: 'business_owner',
  });
  const b = createCompanyAndUser(db, {
    companyName: 'Beta Inc',
    email: 'bob@b.test',
    password: 'BobPass123!',
    roleKey: 'business_owner',
  });

  const aliceToken = await loginToken(request, 'alice@a.test', 'AlicePass123!');

  const res = await request
    .get(`/api/companies/${b.companyId}`)
    .set('Authorization', `Bearer ${aliceToken}`);
  assert.equal(res.status, 403);
});

test('cannot update another company settings', async () => {
  const { request, db, seed } = initTestApp();
  addUserToCompany(db, seed.companyId, {
    name: 'Alice Owner',
    email: 'alice@a.test',
    password: 'AlicePass123!',
    roleKey: 'business_owner',
  });
  const b = createCompanyAndUser(db, {
    companyName: 'Beta Inc',
    email: 'bob@b.test',
    password: 'BobPass123!',
    roleKey: 'business_owner',
  });

  const aliceToken = await loginToken(request, 'alice@a.test', 'AlicePass123!');

  const res = await request
    .put(`/api/companies/${b.companyId}`)
    .set('Authorization', `Bearer ${aliceToken}`)
    .send({ name: 'Hacked' });
  assert.equal(res.status, 403);
});

test('super admin can list all users across companies', async () => {
  const { request, db, seed } = initTestApp();
  addUserToCompany(db, seed.companyId, {
    name: 'Alice Owner',
    email: 'alice@a.test',
    password: 'AlicePass123!',
    roleKey: 'business_owner',
  });
  createCompanyAndUser(db, {
    companyName: 'Beta Inc',
    email: 'bob@b.test',
    password: 'BobPass123!',
    roleKey: 'business_owner',
  });

  const adminToken = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const res = await request.get('/api/users').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200);
  const emails = res.body.data.map((u) => u.email);
  assert.ok(emails.includes('alice@a.test'));
  assert.ok(emails.includes('bob@b.test'));
});

test('global search is scoped to the requesting company', async () => {
  const { request, db, seed } = initTestApp();
  addUserToCompany(db, seed.companyId, {
    name: 'Alice Unique',
    email: 'alice@a.test',
    password: 'AlicePass123!',
    roleKey: 'business_owner',
  });
  createCompanyAndUser(db, {
    companyName: 'Beta Inc',
    email: 'bob@b.test',
    password: 'BobPass123!',
    roleKey: 'business_owner',
  });

  const aliceToken = await loginToken(request, 'alice@a.test', 'AlicePass123!');
  const res = await request.get('/api/search?q=alice').set('Authorization', `Bearer ${aliceToken}`);
  assert.equal(res.status, 200);
  const emails = res.body.data.results.users.map((u) => u.email);
  assert.ok(emails.includes('alice@a.test'));
  assert.ok(!emails.includes('bob@b.test'));
});
