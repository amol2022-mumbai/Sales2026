import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser, createUserInCompany, TEST_ADMIN } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * Provision two tenants (Alpha and Beta) plus a full set of tenant-owned
 * records in Beta. Returns the app handle, both auth tokens, and every Beta
 * record id so tests can assert Alpha is denied cross-tenant access.
 */
function setupTenants() {
  const { request, db, seed } = initTestApp();

  const alpha = createCompanyAndUser(db, {
    companyName: 'Alpha Co',
    email: 'alpha@b.test',
    password: 'AlphaPass123!',
    roleKey: 'business_owner',
  });
  const beta = createCompanyAndUser(db, {
    companyName: 'Beta Co',
    email: 'beta@b.test',
    password: 'BetaPass123!',
    roleKey: 'business_owner',
  });

  const betaExecId = createUserInCompany(db, beta.companyId, {
    name: 'Beta Executive',
    email: 'exec@beta.test',
    password: 'ExecPass123!',
    roleKey: 'sales_executive',
  });

  const leadId = Number(
    db.prepare("INSERT INTO leads (company_id, company_name, assigned_to) VALUES (?, 'Beta Secret Lead', ?)").run(
      beta.companyId,
      beta.userId
    ).lastInsertRowid
  );

  const customerId = Number(
    db.prepare("INSERT INTO customers (company_id, name, assigned_to) VALUES (?, 'Beta Secret Customer', ?)").run(
      beta.companyId,
      beta.userId
    ).lastInsertRowid
  );

  const opportunityId = Number(
    db.prepare(
      "INSERT INTO opportunities (company_id, target_type, lead_id, assigned_to) VALUES (?, 'lead', ?, ?)"
    ).run(beta.companyId, leadId, beta.userId).lastInsertRowid
  );

  const followUpId = Number(
    db.prepare(
      "INSERT INTO follow_ups (company_id, target_type, lead_id, activity_type, follow_up_date, assigned_to) VALUES (?, 'lead', ?, 'call', '2030-01-01', ?)"
    ).run(beta.companyId, leadId, beta.userId).lastInsertRowid
  );

  const invoiceId = Number(
    db.prepare('INSERT INTO invoices (company_id, customer_id, amount, assigned_to) VALUES (?, ?, 1000, ?)').run(
      beta.companyId,
      customerId,
      beta.userId
    ).lastInsertRowid
  );

  const paymentId = Number(
    db.prepare(
      "INSERT INTO payments (company_id, invoice_id, customer_id, amount, payment_date) VALUES (?, ?, ?, 100, '2030-01-01')"
    ).run(beta.companyId, invoiceId, customerId).lastInsertRowid
  );

  const targetId = Number(
    db.prepare(
      "INSERT INTO targets (company_id, scope, target_type, period_type, target_value, start_date, end_date) VALUES (?, 'company', 'sales', 'monthly', 1000, '2030-01-01', '2030-01-31')"
    ).run(beta.companyId).lastInsertRowid
  );

  const teamId = Number(
    db.prepare("INSERT INTO teams (company_id, name, is_active) VALUES (?, 'Beta Secret Team', 1)").run(beta.companyId)
      .lastInsertRowid
  );

  // Audit entries for both tenants to verify audit-list scoping.
  db.prepare("INSERT INTO audit_logs (company_id, user_id, action) VALUES (?, ?, 'beta.private.action')").run(
    beta.companyId,
    beta.userId
  );
  db.prepare("INSERT INTO audit_logs (company_id, user_id, action) VALUES (?, ?, 'alpha.own.action')").run(
    alpha.companyId,
    alpha.userId
  );

  return {
    request,
    db,
    seed,
    alpha,
    beta,
    betaExecId,
    ids: { leadId, customerId, opportunityId, followUpId, invoiceId, paymentId, targetId, teamId },
  };
}

async function tokensFor(request, alpha, beta, seed) {
  const alphaToken = await loginToken(request, 'alpha@b.test', 'AlphaPass123!');
  const betaToken = await loginToken(request, 'beta@b.test', 'BetaPass123!');
  const adminToken = await loginToken(request, seed.adminEmail, TEST_ADMIN.password);
  return { alphaToken, betaToken, adminToken };
}

test('Tenant A cannot read, modify or delete Tenant B leads', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { alphaToken, adminToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.get(`/api/leads/${ids.leadId}`).set(auth(alphaToken))).status, 403);
  assert.equal(
    (await request.put(`/api/leads/${ids.leadId}`).set(auth(alphaToken)).send({ companyName: 'Hacked' })).status,
    403
  );
  assert.equal((await request.delete(`/api/leads/${ids.leadId}`).set(auth(alphaToken))).status, 403);

  const list = await request.get('/api/leads').set(auth(alphaToken));
  assert.ok(!list.body.data.some((l) => l.id === ids.leadId));

  // Positive control: super admin can still access the record.
  assert.equal((await request.get(`/api/leads/${ids.leadId}`).set(auth(adminToken))).status, 200);
});

test('Tenant A cannot read, modify or delete Tenant B customers', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.get(`/api/customers/${ids.customerId}`).set(auth(alphaToken))).status, 403);
  assert.equal(
    (await request.put(`/api/customers/${ids.customerId}`).set(auth(alphaToken)).send({ name: 'Hacked' })).status,
    403
  );
  assert.equal((await request.delete(`/api/customers/${ids.customerId}`).set(auth(alphaToken))).status, 403);

  const list = await request.get('/api/customers').set(auth(alphaToken));
  assert.ok(!list.body.data.some((c) => c.id === ids.customerId));
});

test('Tenant A cannot read, modify or delete Tenant B opportunities', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.get(`/api/pipeline/${ids.opportunityId}`).set(auth(alphaToken))).status, 403);
  assert.equal(
    (await request.put(`/api/pipeline/${ids.opportunityId}`).set(auth(alphaToken)).send({ notes: 'Hacked' })).status,
    403
  );
  assert.equal((await request.delete(`/api/pipeline/${ids.opportunityId}`).set(auth(alphaToken))).status, 403);

  const list = await request.get('/api/pipeline').set(auth(alphaToken));
  assert.ok(!list.body.data.some((o) => o.id === ids.opportunityId));
});

test('Tenant A cannot read, modify or delete Tenant B follow-ups', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.get(`/api/follow-ups/${ids.followUpId}`).set(auth(alphaToken))).status, 403);
  assert.equal(
    (await request.put(`/api/follow-ups/${ids.followUpId}`).set(auth(alphaToken)).send({ notes: 'Hacked' })).status,
    403
  );
  assert.equal((await request.delete(`/api/follow-ups/${ids.followUpId}`).set(auth(alphaToken))).status, 403);

  const list = await request.get('/api/follow-ups').set(auth(alphaToken));
  assert.ok(!list.body.data.some((f) => f.id === ids.followUpId));
});

test('Tenant A cannot read, modify or delete Tenant B invoices', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.get(`/api/collections/${ids.invoiceId}`).set(auth(alphaToken))).status, 403);
  assert.equal(
    (await request.put(`/api/collections/${ids.invoiceId}`).set(auth(alphaToken)).send({ amount: 5 })).status,
    403
  );
  assert.equal((await request.delete(`/api/collections/${ids.invoiceId}`).set(auth(alphaToken))).status, 403);

  const list = await request.get('/api/collections').set(auth(alphaToken));
  assert.ok(!list.body.data.some((i) => i.id === ids.invoiceId));
});

test('Tenant A cannot delete or query Tenant B payments', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.delete(`/api/collections/payments/${ids.paymentId}`).set(auth(alphaToken))).status, 403);

  const list = await request.get('/api/collections/payments').set(auth(alphaToken));
  assert.ok(!list.body.data.some((p) => p.id === ids.paymentId));
});

test('Tenant A cannot read, modify or delete Tenant B targets', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.get(`/api/targets/${ids.targetId}`).set(auth(alphaToken))).status, 403);
  assert.equal(
    (await request.put(`/api/targets/${ids.targetId}`).set(auth(alphaToken)).send({ targetValue: 5 })).status,
    403
  );
  assert.equal((await request.delete(`/api/targets/${ids.targetId}`).set(auth(alphaToken))).status, 403);

  const list = await request.get('/api/targets').set(auth(alphaToken));
  assert.ok(!list.body.data.some((t) => t.id === ids.targetId));
});

test('Tenant A cannot read, modify or manage Tenant B teams', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.get(`/api/teams/${ids.teamId}`).set(auth(alphaToken))).status, 403);
  assert.equal(
    (await request.put(`/api/teams/${ids.teamId}`).set(auth(alphaToken)).send({ name: 'Hacked Team' })).status,
    403
  );
  assert.equal(
    (await request.delete(`/api/teams/${ids.teamId}/members/${beta.userId}`).set(auth(alphaToken))).status,
    403
  );

  const list = await request.get('/api/teams').set(auth(alphaToken));
  assert.ok(!list.body.data.some((t) => t.id === ids.teamId));
});

test('Tenant A cannot read, modify or manage Tenant B users', async () => {
  const { request, alpha, beta, seed, betaExecId } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  assert.equal((await request.get(`/api/users/${betaExecId}`).set(auth(alphaToken))).status, 403);
  assert.equal(
    (await request.put(`/api/users/${betaExecId}`).set(auth(alphaToken)).send({ name: 'Hacked User' })).status,
    403
  );
  assert.equal(
    (await request.post(`/api/users/${betaExecId}/reset-password`).set(auth(alphaToken)).send({ password: 'Hacked123!' }))
      .status,
    403
  );
  assert.equal(
    (await request.post(`/api/users/${betaExecId}/status`).set(auth(alphaToken)).send({ status: 'inactive' })).status,
    403
  );

  const list = await request.get('/api/users').set(auth(alphaToken));
  assert.ok(!list.body.data.some((u) => u.id === betaExecId));
});

test('audit logs are scoped to the requesting tenant', async () => {
  const { request, alpha, beta, seed } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  const res = await request.get('/api/audit-logs').set(auth(alphaToken));
  assert.equal(res.status, 200);
  const actions = res.body.data.map((a) => a.action);
  assert.ok(actions.includes('alpha.own.action'));
  assert.ok(!actions.includes('beta.private.action'));
  assert.ok(res.body.data.every((a) => a.companyId === null || a.companyId === alpha.companyId));
});

test('global search does not leak Tenant B leads, customers or teams', async () => {
  const { request, alpha, beta, seed } = setupTenants();
  const { alphaToken } = await tokensFor(request, alpha, beta, seed);

  const leads = await request.get('/api/search?q=Beta%20Secret').set(auth(alphaToken));
  assert.equal(leads.status, 200);
  assert.ok(!leads.body.data.results.leads.some((l) => l.company_id === beta.companyId));
  assert.ok(!leads.body.data.results.customers.some((c) => c.company_id === beta.companyId));
  assert.ok(!leads.body.data.results.teams.some((t) => t.company_id === beta.companyId));
});

test('super admin can query cross-tenant data through admin APIs', async () => {
  const { request, alpha, beta, seed, ids } = setupTenants();
  const { adminToken } = await tokensFor(request, alpha, beta, seed);

  const list = await request.get(`/api/leads?companyId=${beta.companyId}`).set(auth(adminToken));
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some((l) => l.id === ids.leadId));
});
