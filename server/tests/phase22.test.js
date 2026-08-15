import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser, getRoleId } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function getPlanId(request, admin, key) {
  const res = await request.get('/api/admin/plans').set(auth(admin));
  const plan = res.body.data.find((p) => p.key === key);
  assert.ok(plan, `expected seeded plan "${key}"`);
  return plan.id;
}

// List endpoints that must start empty for a freshly onboarded tenant.
const EMPTY_LIST_ENDPOINTS = [
  '/api/leads',
  '/api/customers',
  '/api/pipeline',
  '/api/orders',
  '/api/products',
  '/api/teams',
  '/api/targets',
  '/api/quotations',
  '/api/collections',
  '/api/follow-ups',
];

// ---------------------------------------------------------------------------
// Final launch: full client lifecycle, clean demo tenant & cross-tenant denial
// ---------------------------------------------------------------------------

test('phase 22: full client lifecycle produces an active, isolated demo tenant with empty data', async () => {
  const { request, seed } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const planId = await getPlanId(request, admin, 'enterprise');

  // 1. Super Admin onboards the demo tenant with a trial license + admin invite.
  const onboard = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({
      name: 'Demo Client',
      domain: 'demo.launch.test',
      industry: 'Retail',
      planId,
      licenseStatus: 'trial',
      userLimit: 25,
      adminName: 'Demo Admin',
      adminEmail: 'demo-admin@launch.test',
    });
  assert.equal(onboard.status, 201);
  const companyId = onboard.body.data.company.id;
  const invitationToken = onboard.body.data.invitation.invitationToken;

  // 2. Company Admin sets their password and is signed in.
  const accept = await request
    .post('/api/auth/accept-invite')
    .send({ token: invitationToken, password: 'DemoPass123!' });
  assert.equal(accept.status, 200);
  const adminToken = accept.body.data.token;
  assert.equal(accept.body.data.user.roleKey, 'business_owner');
  assert.ok(['trial', 'expiring'].includes(accept.body.data.tenant.lifecycleStatus));

  // 3. Company Admin completes onboarding with logo/branding + business details.
  const setup = await request
    .post(`/api/companies/${companyId}/complete-setup`)
    .set(auth(adminToken))
    .send({
      name: 'Demo Client',
      email: 'hello@demo.launch.test',
      website: 'https://demo.launch.test',
      city: 'Austin',
      country: 'US',
      currency: 'USD',
      timezone: 'America/Chicago',
      logoUrl: 'https://demo.launch.test/logo.png',
      faviconUrl: 'https://demo.launch.test/favicon.ico',
    });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.data.logoUrl, 'https://demo.launch.test/logo.png');
  assert.equal(setup.body.data.faviconUrl, 'https://demo.launch.test/favicon.ico');
  assert.ok(setup.body.data.onboardedAt);

  // 4. Super Admin activates the tenant.
  const activate = await request.post(`/api/admin/clients/${companyId}/activate`).set(auth(admin));
  assert.equal(activate.status, 200);
  assert.equal(activate.body.data.status, 'active');

  // 5. Demo tenant starts empty across every CRM module.
  for (const path of EMPTY_LIST_ENDPOINTS) {
    const res = await request.get(path).set(auth(adminToken));
    assert.equal(res.status, 200, `${path} should be accessible`);
    assert.equal(res.body.data.length, 0, `${path} should be empty for a fresh demo tenant`);
  }

  // 6. Cross-tenant denial: demo admin cannot read the seeded tenant's company.
  const other = await request.get(`/api/companies/${seed.companyId}`).set(auth(adminToken));
  assert.equal(other.status, 403);

  // 7. Session reflects the active, onboarded tenant.
  const me = await request.get('/api/auth/me').set(auth(adminToken));
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, 'demo-admin@launch.test');
  assert.equal(me.body.data.tenant.onboardedAt, setup.body.data.onboardedAt);
  assert.ok(['trial', 'expiring'].includes(me.body.data.tenant.lifecycleStatus));
});

// ---------------------------------------------------------------------------
// All six company roles can be provisioned and authenticate
// ---------------------------------------------------------------------------

test('phase 22: all six company roles are provisionable and can log in', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'Role Matrix Co',
    email: 'owner@roles.test',
    password: 'OwnerPass123!',
    roleKey: 'business_owner',
  });
  const ownerToken = await loginToken(request, 'owner@roles.test', 'OwnerPass123!');

  const roles = [
    ['sales_manager', 'Sales Manager', 'manager@roles.test'],
    ['team_leader', 'Team Leader', 'leader@roles.test'],
    ['sales_executive', 'Sales Executive', 'exec@roles.test'],
    ['accountant', 'Accountant', 'acct@roles.test'],
    ['viewer', 'Viewer', 'viewer@roles.test'],
  ];

  for (const [key, name, email] of roles) {
    const created = await request
      .post('/api/users')
      .set(auth(ownerToken))
      .send({ name, email, password: 'UserPass123!', roleId: getRoleId(db, key) });
    assert.equal(created.status, 201, `create ${key} (${created.body.error?.message || ''})`);
    assert.equal(created.body.data.roleKey, key);
    assert.equal(created.body.data.companyId, companyId);
  }

  const logins = [
    ['business_owner', 'owner@roles.test', 'OwnerPass123!'],
    ['sales_manager', 'manager@roles.test', 'UserPass123!'],
    ['team_leader', 'leader@roles.test', 'UserPass123!'],
    ['sales_executive', 'exec@roles.test', 'UserPass123!'],
    ['accountant', 'acct@roles.test', 'UserPass123!'],
    ['viewer', 'viewer@roles.test', 'UserPass123!'],
  ];

  for (const [key, email, password] of logins) {
    const login = await request.post('/api/auth/login').send({ email, password });
    assert.equal(login.status, 200, `login ${key} (${login.body.error?.message || ''})`);
    assert.equal(login.body.data.user.roleKey, key);
    assert.equal(login.body.data.user.companyId, companyId);
  }
});
