import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function getPlanId(request, admin, key) {
  const res = await request.get('/api/admin/plans').set(auth(admin));
  const plan = res.body.data.find((p) => p.key === key);
  assert.ok(plan, `expected seeded plan "${key}"`);
  return plan.id;
}

// ---------------------------------------------------------------------------
// Composite onboarding (Super Admin)
// ---------------------------------------------------------------------------

test('super admin can onboard a tenant with plan, license and pending admin in one call', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const planId = await getPlanId(request, admin, 'professional');

  const res = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({
      name: 'Onboarded Corp',
      domain: 'onboarded.example.com',
      industry: 'Software',
      planId,
      licenseStatus: 'trial',
      userLimit: 10,
      adminName: 'Jane Admin',
      adminEmail: 'jane@onboarded.test',
    });

  assert.equal(res.status, 201);
  const { company, license, invitation } = res.body.data;

  assert.ok(company.id);
  assert.equal(company.name, 'Onboarded Corp');
  assert.equal(company.status, 'active');
  assert.equal(company.onboardedAt, null);
  assert.equal(company.activatedAt, null);

  assert.ok(license.id);
  assert.equal(license.status, 'trial');
  assert.equal(license.userLimit, 10);
  assert.ok(license.expiresAt, 'trial license should derive an expiry from the plan trial_days');

  assert.ok(invitation.invitationToken);
  assert.equal(invitation.email, 'jane@onboarded.test');
  assert.equal(invitation.status, 'pending');

  const userRow = db.prepare("SELECT status, company_id, role_id FROM users WHERE email = 'jane@onboarded.test'").get();
  assert.equal(userRow.status, 'pending');
  assert.equal(userRow.company_id, company.id);

  // No license / no admin is allowed too (company-only onboarding).
  const companyOnly = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({ name: 'Bare Tenant' });
  assert.equal(companyOnly.status, 201);
  assert.equal(companyOnly.body.data.license, null);
  assert.equal(companyOnly.body.data.invitation, null);
});

test('onboarding rejects a duplicate admin email and a duplicate domain', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const first = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({ name: 'First Tenant', domain: 'dup.example.com', adminName: 'A', adminEmail: 'dupadmin@dup.test' });
  assert.equal(first.status, 201);

  const dupDomain = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({ name: 'Second Tenant', domain: 'dup.example.com' });
  assert.equal(dupDomain.status, 409);

  const dupEmail = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({ name: 'Third Tenant', adminName: 'B', adminEmail: 'dupadmin@dup.test' });
  assert.equal(dupEmail.status, 409);
});

test('non-super-admin cannot onboard, activate, suspend or deactivate a tenant', async () => {
  const { request, db, seed } = initTestApp();
  createCompanyAndUser(db, { companyName: 'Rogue Co', email: 'rogue@onboard.test', password: 'RoguePass123!', roleKey: 'business_owner' });
  const rogue = await loginToken(request, 'rogue@onboard.test', 'RoguePass123!');

  const onboard = await request
    .post('/api/admin/clients/onboard')
    .set(auth(rogue))
    .send({ name: 'Nope' });
  assert.equal(onboard.status, 403);

  for (const action of ['activate', 'suspend', 'deactivate']) {
    const res = await request.post(`/api/admin/clients/${seed.companyId}/${action}`).set(auth(rogue));
    assert.equal(res.status, 403, `${action} should be forbidden`);
  }
});

// ---------------------------------------------------------------------------
// Company Admin first-login flow
// ---------------------------------------------------------------------------

test('onboarded admin can accept invite, complete setup, and the tenant can be activated', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const planId = await getPlanId(request, admin, 'professional');

  const onboard = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({ name: 'Setup Co', planId, licenseStatus: 'active', adminName: 'Sam Admin', adminEmail: 'sam@setup.test' });
  assert.equal(onboard.status, 201);
  const companyId = onboard.body.data.company.id;

  const accept = await request
    .post('/api/auth/accept-invite')
    .send({ token: onboard.body.data.invitation.invitationToken, password: 'SamPass123!' });
  assert.equal(accept.status, 200);
  const adminToken = accept.body.data.token;
  assert.equal(accept.body.data.user.companyId, companyId);
  assert.equal(accept.body.data.tenant.onboardedAt, null);

  const setup = await request
    .post(`/api/companies/${companyId}/complete-setup`)
    .set(auth(adminToken))
    .send({ name: 'Setup Co (Acme)', email: 'hello@setup.test', timezone: 'Asia/Kolkata', currency: 'INR' });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.data.name, 'Setup Co (Acme)');
  assert.equal(setup.body.data.slug, 'setup-co-acme');
  assert.ok(setup.body.data.onboardedAt, 'onboardedAt should be stamped');

  // Completing setup again must not overwrite the original onboarded_at.
  const again = await request
    .post(`/api/companies/${companyId}/complete-setup`)
    .set(auth(adminToken))
    .send({ name: 'Setup Co Final' });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.onboardedAt, setup.body.data.onboardedAt);

  // Super admin activates the tenant.
  const activate = await request.post(`/api/admin/clients/${companyId}/activate`).set(auth(admin));
  assert.equal(activate.status, 200);
  assert.equal(activate.body.data.status, 'active');
  assert.ok(activate.body.data.activatedAt, 'activatedAt should be stamped');

  const detail = await request.get(`/api/admin/clients/${companyId}`).set(auth(admin));
  assert.equal(detail.body.data.lifecycleStatus, 'active');
  assert.equal(detail.body.data.onboardedAt, setup.body.data.onboardedAt);
  assert.equal(detail.body.data.activatedAt, activate.body.data.activatedAt);
});

test('complete-setup is forbidden for another company', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Tenant B', email: 'bob@setup.test', password: 'BobPass123!', roleKey: 'business_owner' });
  const bob = await loginToken(request, 'bob@setup.test', 'BobPass123!');

  const onboard = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({ name: 'Other Co', adminName: 'Other Admin', adminEmail: 'other@setup.test' });
  const otherId = onboard.body.data.company.id;

  const res = await request.post(`/api/companies/${otherId}/complete-setup`).set(auth(bob)).send({ name: 'Hijack' });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Tenant lifecycle resolution & actions
// ---------------------------------------------------------------------------

test('a tenant without a license is reported as lifecycle "pending"', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const created = await request.post('/api/admin/clients').set(auth(admin)).send({ name: 'Pending Co' });
  const detail = await request.get(`/api/admin/clients/${created.body.data.id}`).set(auth(admin));
  assert.equal(detail.body.data.lifecycleStatus, 'pending');
});

test('suspend and deactivate lifecycle actions block tenant users', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const { companyId } = createCompanyAndUser(db, { companyName: 'Lifecycle Co', email: 'owner@lifecycle.test', password: 'OwnerPass123!', roleKey: 'business_owner' });
  const ownerToken = await loginToken(request, 'owner@lifecycle.test', 'OwnerPass123!');

  const suspend = await request.post(`/api/admin/clients/${companyId}/suspend`).set(auth(admin));
  assert.equal(suspend.status, 200);
  assert.equal(suspend.body.data.status, 'suspended');

  const blocked = await request.get('/api/auth/me').set(auth(ownerToken));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'TENANT_SUSPENDED');

  const activate = await request.post(`/api/admin/clients/${companyId}/activate`).set(auth(admin));
  assert.equal(activate.status, 200);
  assert.equal(activate.body.data.status, 'active');

  const restored = await request.get('/api/auth/me').set(auth(ownerToken));
  assert.equal(restored.status, 200);

  const deactivate = await request.post(`/api/admin/clients/${companyId}/deactivate`).set(auth(admin));
  assert.equal(deactivate.status, 200);
  assert.equal(deactivate.body.data.status, 'inactive');

  const blockedAgain = await request.get('/api/auth/me').set(auth(ownerToken));
  assert.equal(blockedAgain.status, 403);
  assert.equal(blockedAgain.body.error.code, 'TENANT_INACTIVE');

  const list = await request.get('/api/admin/clients').set(auth(admin));
  const entry = list.body.data.find((c) => c.id === companyId);
  assert.equal(entry.lifecycleStatus, 'deactivated');
});

test('lifecycle actions and onboarding are audited', async () => {
  const { request, db } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const planId = await getPlanId(request, admin, 'basic');

  const onboard = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({ name: 'Audit Co', planId, licenseStatus: 'active', adminName: 'Audit Admin', adminEmail: 'audit@audit.test' });
  const companyId = onboard.body.data.company.id;

  await request.post(`/api/admin/clients/${companyId}/suspend`).set(auth(admin));
  await request.post(`/api/admin/clients/${companyId}/activate`).set(auth(admin));

  const actions = db
    .prepare("SELECT action FROM audit_logs WHERE entity_type = 'company' AND entity_id = ? ORDER BY id")
    .all(String(companyId))
    .map((r) => r.action);

  for (const expected of ['tenant.create', 'tenant.suspend', 'tenant.activate']) {
    assert.ok(actions.includes(expected), `expected audit action "${expected}", got ${JSON.stringify(actions)}`);
  }
  assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'tenant.invite_admin' AND metadata LIKE '%audit@audit.test%'").get());
});
