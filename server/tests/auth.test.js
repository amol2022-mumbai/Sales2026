import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, TEST_ADMIN } from './helpers.js';

test('login succeeds with valid credentials and returns JWT + user', async () => {
  const { request } = initTestApp();
  const res = await request.post('/api/auth/login').send({
    email: TEST_ADMIN.email,
    password: TEST_ADMIN.password,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.token);
  assert.equal(res.body.data.user.email, TEST_ADMIN.email);
  assert.equal(res.body.data.user.isSuperAdmin, true);
  assert.ok(res.body.data.user.permissions.includes('*'));
});

test('login fails with wrong password', async () => {
  const { request } = initTestApp();
  const res = await request.post('/api/auth/login').send({
    email: TEST_ADMIN.email,
    password: 'wrong-password',
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('login fails with unknown email', async () => {
  const { request } = initTestApp();
  const res = await request.post('/api/auth/login').send({
    email: 'ghost@test.com',
    password: 'whatever123',
  });
  assert.equal(res.status, 401);
});

test('login rejects malformed email', async () => {
  const { request } = initTestApp();
  const res = await request.post('/api/auth/login').send({ email: 'not-an-email', password: 'x' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'BAD_REQUEST');
});

test('protected route rejects missing token', async () => {
  const { request } = initTestApp();
  const res = await request.get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('protected route rejects invalid token', async () => {
  const { request } = initTestApp();
  const res = await request.get('/api/auth/me').set('Authorization', 'Bearer bogus-token');
  assert.equal(res.status, 401);
});

test('me returns the authenticated user', async () => {
  const { request } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.email, TEST_ADMIN.email);
});

test('logout succeeds and is recorded in audit logs', async () => {
  const { request, db } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const res = await request.post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);

  const count = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'auth.logout'").get().c;
  assert.ok(count >= 1);
});

test('change password updates credentials and old password stops working', async () => {
  const { request } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);

  const change = await request
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: TEST_ADMIN.password, newPassword: 'NewPassw0rd!' });
  assert.equal(change.status, 200);

  const relogin = await request
    .post('/api/auth/login')
    .send({ email: TEST_ADMIN.email, password: 'NewPassw0rd!' });
  assert.equal(relogin.status, 200);

  const oldLogin = await request
    .post('/api/auth/login')
    .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
  assert.equal(oldLogin.status, 401);
});

test('change password rejects wrong current password', async () => {
  const { request } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const res = await request
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'nope-nope-nope', newPassword: 'NewPassw0rd!' });
  assert.equal(res.status, 400);
});
