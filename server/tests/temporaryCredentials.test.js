import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, TEST_ADMIN } from './helpers.js';

async function createClient(request, token, name) {
  const res = await request
    .post('/api/admin/clients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`, status: 'active' });
  assert.equal(res.status, 201);
  return res.body.data;
}

async function generateCredentials(request, token, companyId, { name, email }) {
  return request
    .post(`/api/admin/clients/${companyId}/admin-credentials`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name, email });
}

test('Super Admin can generate one-time temporary credentials for a Company Admin', async () => {
  const { request, db } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const client = await createClient(request, token, 'TempCo');

  const res = await generateCredentials(request, token, client.id, {
    name: 'Admin One',
    email: 'admin.one@tempco.com',
  });

  assert.equal(res.status, 200);
  const data = res.body.data;
  assert.equal(data.company, 'TempCo');
  assert.equal(data.username, 'admin.one@tempco.com');
  assert.ok(data.tempPassword.length >= 16);
  assert.ok(data.loginUrl);
  assert.ok(data.loginUrl.includes('relogin=1'));
  assert.ok(data.expiresAt);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('admin.one@tempco.com');
  assert.ok(user, 'user row must exist');
  assert.equal(user.company_id, client.id);
  assert.equal(user.status, 'active');
  assert.equal(user.must_change_password, 1);
  assert.ok(user.temp_password_expires_at);
  assert.notEqual(user.password_hash, data.tempPassword);
});

test('temporary password is never returned again and is absent from audit logs', async () => {
  const { request, db } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const client = await createClient(request, token, 'TempCo');
  const res = await generateCredentials(request, token, client.id, {
    name: 'Admin One',
    email: 'admin.one@tempco.com',
  });
  const { tempPassword } = res.body.data;

  const login = await request
    .post('/api/auth/login')
    .send({ email: 'admin.one@tempco.com', password: tempPassword });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.mustChangePassword, true);
  assert.equal(login.body.data.user.tempPassword, undefined);
  assert.equal(login.body.data.user.passwordHash, undefined);

  const me = await request
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${login.body.data.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.tempPassword, undefined);

  const audits = db.prepare("SELECT metadata FROM audit_logs WHERE action = 'tenant.generate_credentials'").all();
  assert.ok(audits.length >= 1);
  for (const a of audits) {
    assert.ok(!a.metadata.includes(tempPassword), 'audit log must never contain the plaintext password');
  }
});

test('temporary credentials force a password change and block all other access', async () => {
  const { request } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const client = await createClient(request, token, 'TempCo');
  const res = await generateCredentials(request, token, client.id, {
    name: 'Admin One',
    email: 'admin.one@tempco.com',
  });
  const { tempPassword } = res.body.data;

  const login = await request
    .post('/api/auth/login')
    .send({ email: 'admin.one@tempco.com', password: tempPassword });
  assert.equal(login.status, 200);
  const userToken = login.body.data.token;

  const leads = await request.get('/api/leads').set('Authorization', `Bearer ${userToken}`);
  assert.equal(leads.status, 403);
  assert.equal(leads.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

  const profile = await request.get('/api/users').set('Authorization', `Bearer ${userToken}`);
  assert.equal(profile.status, 403);

  const setRes = await request
    .post('/api/auth/set-password')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ newPassword: 'NewSecurePass1!' });
  assert.equal(setRes.status, 200);

  const me = await request.get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.mustChangePassword, false);

  const leadsAfter = await request.get('/api/leads').set('Authorization', `Bearer ${userToken}`);
  assert.equal(leadsAfter.status, 200);

  const oldPasswordLogin = await request
    .post('/api/auth/login')
    .send({ email: 'admin.one@tempco.com', password: tempPassword });
  assert.equal(oldPasswordLogin.status, 401);
});

test('expired temporary credentials are rejected at login', async () => {
  const { request, db } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const client = await createClient(request, token, 'TempCo');
  const res = await generateCredentials(request, token, client.id, {
    name: 'Admin One',
    email: 'admin.one@tempco.com',
  });
  const { tempPassword } = res.body.data;

  db.prepare('UPDATE users SET temp_password_expires_at = ? WHERE email = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    'admin.one@tempco.com'
  );

  const login = await request
    .post('/api/auth/login')
    .send({ email: 'admin.one@tempco.com', password: tempPassword });
  assert.equal(login.status, 401);
});

test('invalid temporary credentials are rejected', async () => {
  const { request } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const client = await createClient(request, token, 'TempCo');
  await generateCredentials(request, token, client.id, {
    name: 'Admin One',
    email: 'admin.one@tempco.com',
  });

  const login = await request
    .post('/api/auth/login')
    .send({ email: 'admin.one@tempco.com', password: 'totally-wrong-password' });
  assert.equal(login.status, 401);
});

test('regenerating credentials resets password and keeps single-company isolation', async () => {
  const { request, db } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const clientA = await createClient(request, token, 'Company A');
  const clientB = await createClient(request, token, 'Company B');

  const first = await generateCredentials(request, token, clientA.id, {
    name: 'Admin A',
    email: 'admin.a@example.com',
  });
  const firstPassword = first.body.data.tempPassword;

  const second = await generateCredentials(request, token, clientA.id, {
    name: 'Admin A',
    email: 'admin.a@example.com',
  });
  const secondPassword = second.body.data.tempPassword;
  assert.notEqual(firstPassword, secondPassword);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('admin.a@example.com');
  assert.equal(user.company_id, clientA.id);
  assert.equal(user.must_change_password, 1);

  const oldLogin = await request
    .post('/api/auth/login')
    .send({ email: 'admin.a@example.com', password: firstPassword });
  assert.equal(oldLogin.status, 401);

  const crossCompany = await generateCredentials(request, token, clientB.id, {
    name: 'Admin A',
    email: 'admin.a@example.com',
  });
  assert.equal(crossCompany.status, 409);
});

test('generate credentials is Super Admin only', async () => {
  const { request, db } = initTestApp();
  const token = await loginToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
  const client = await createClient(request, token, 'TempCo');

  const anon = await generateCredentials(request, null, client.id, {
    name: 'Admin One',
    email: 'admin.one@tempco.com',
  });
  assert.equal(anon.status, 401);

  const gen = await generateCredentials(request, token, client.id, {
    name: 'Admin One',
    email: 'admin.one@tempco.com',
  });
  assert.equal(gen.status, 200);

  const adminToken = await request
    .post('/api/auth/login')
    .send({ email: 'admin.one@tempco.com', password: gen.body.data.tempPassword })
    .then((r) => r.body.data.token);

  const forbidden = await generateCredentials(request, adminToken, client.id, {
    name: 'Another',
    email: 'another@tempco.com',
  });
  assert.equal(forbidden.status, 403);
});
