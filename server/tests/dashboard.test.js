import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initTestApp,
  loginToken,
  createCompanyAndUser,
  createUserInCompany,
  createTeam,
} from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function pad(n) {
  return String(n).padStart(2, '0');
}

function currentMonthDate(day) {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(day)}`;
}

function kpiValue(data, key) {
  const kpi = data.kpis.find((k) => k.key === key);
  return kpi ? kpi.value : undefined;
}

function insertLicense(db, companyId, { status = 'active', planId = null, expiresAt = null, userLimit = null, modules = null } = {}) {
  return Number(
    db
      .prepare(
        `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, user_limit, modules)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(companyId, planId, status, '2026-01-01', expiresAt, userLimit, modules == null ? null : JSON.stringify(modules)).lastInsertRowid
  );
}

function insertLead(db, companyId, { assignedTo = null, teamId = null, status = 'New' } = {}) {
  return Number(
    db
      .prepare(
        `INSERT INTO leads (company_id, company_name, contact_person, status, assigned_to, team_id, created_at, updated_at)
         VALUES (?, 'Prospect Co', 'Contact', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      )
      .run(companyId, status, assignedTo, teamId).lastInsertRowid
  );
}

function insertOpportunity(db, companyId, { assignedTo = null, teamId = null, stage = 'Won', dealValue = 50000, closeDate }) {
  return Number(
    db
      .prepare(
        `INSERT INTO opportunities (company_id, target_type, deal_value, probability, expected_close_date, assigned_to, team_id, stage, priority)
         VALUES (?, 'lead', ?, 100, ?, ?, ?, ?, 'Medium')`
      )
      .run(companyId, dealValue, closeDate, assignedTo, teamId, stage).lastInsertRowid
  );
}

function insertInvoice(db, companyId, { customerId, amount = 5000 }) {
  return Number(
    db
      .prepare(
        `INSERT INTO invoices (company_id, customer_id, amount, due_date, status, created_at, updated_at)
         VALUES (?, ?, ?, '2026-09-15', 'Unpaid', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      )
      .run(companyId, customerId, amount).lastInsertRowid
  );
}

function insertCustomer(db, companyId) {
  const result = db
    .prepare(`INSERT INTO customers (company_id, name, contact_person) VALUES (?, 'Customer Co', 'Contact')`)
    .run(companyId);
  return Number(result.lastInsertRowid);
}

function insertPayment(db, companyId, { invoiceId, customerId, amount = 2000, date }) {
  return Number(
    db
      .prepare(
        `INSERT INTO payments (company_id, invoice_id, customer_id, amount, payment_date, method)
         VALUES (?, ?, ?, ?, ?, 'Bank Transfer')`
      )
      .run(companyId, invoiceId, customerId, amount, date).lastInsertRowid
  );
}

async function setupHierarchy() {
  const { request, db, seed } = initTestApp();
  const a = seed.companyId;

  const owner = createUserInCompany(db, a, { name: 'Owner', email: 'owner@a.test', password: 'OwnerPass123!', roleKey: 'business_owner' });
  const manager = createUserInCompany(db, a, { name: 'Manager', email: 'manager@a.test', password: 'ManagerPass123!', roleKey: 'sales_manager' });
  const leader = createUserInCompany(db, a, { name: 'Leader', email: 'leader@a.test', password: 'LeaderPass123!', roleKey: 'team_leader' });
  const exec1 = createUserInCompany(db, a, { name: 'Exec One', email: 'exec1@a.test', password: 'Exec1Pass123!', roleKey: 'sales_executive' });
  const exec2 = createUserInCompany(db, a, { name: 'Exec Two', email: 'exec2@a.test', password: 'Exec2Pass123!', roleKey: 'sales_executive' });

  const teamAlpha = createTeam(db, a, { name: 'Team Alpha', leadId: leader, managerId: manager });
  const teamBeta = createTeam(db, a, { name: 'Team Beta' });
  db.prepare('UPDATE users SET team_id = ?, manager_id = ? WHERE id IN (?, ?)').run(teamAlpha, manager, leader, exec1);
  db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(teamBeta, exec2);

  createCompanyAndUser(db, { companyName: 'Beta Inc', email: 'bob@b.test', password: 'BobPass123!', roleKey: 'business_owner' });

  const tokens = {
    admin: await loginToken(request, 'admin@test.com', 'AdminPass123!'),
    owner: await loginToken(request, 'owner@a.test', 'OwnerPass123!'),
    manager: await loginToken(request, 'manager@a.test', 'ManagerPass123!'),
    leader: await loginToken(request, 'leader@a.test', 'LeaderPass123!'),
    exec1: await loginToken(request, 'exec1@a.test', 'Exec1Pass123!'),
    exec2: await loginToken(request, 'exec2@a.test', 'Exec2Pass123!'),
    bob: await loginToken(request, 'bob@b.test', 'BobPass123!'),
  };

  return { request, db, seed, ids: { owner, manager, leader, exec1, exec2, teamAlpha, teamBeta }, tokens };
}

// ---------------------------------------------------------------------------
// Super Admin platform dashboard
// ---------------------------------------------------------------------------

test('super admin platform dashboard exposes SaaS analytics', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const beta = db.prepare("SELECT id FROM companies WHERE name = 'Beta Inc'").get();
  const planId = Number(db.prepare("INSERT INTO plans (key, name, user_limit, price_monthly) VALUES ('saas_pro', 'SaaS Pro', 10, 99)").run().lastInsertRowid);
  insertLicense(db, beta.id, { status: 'trial', planId, expiresAt: '2027-01-01' });

  const res = await request.get('/api/admin/dashboard').set(auth(tokens.admin));
  assert.equal(res.status, 200);
  const d = res.body.data;

  assert.ok(d.totals.companies >= 2);
  assert.equal(typeof d.totals.activeCompanies, 'number');
  assert.equal(typeof d.totals.activeUsers, 'number');
  assert.equal(typeof d.totals.plans, 'number');
  assert.equal(d.totals.license.trial >= 1, true);
  assert.equal(typeof d.totals.license.expiringSoon, 'number');
  assert.equal(typeof d.totals.mrr, 'number');
  assert.equal(typeof d.totals.arr, 'number');
  assert.ok(Array.isArray(d.featureUsage));
  assert.ok(d.featureUsage.length > 0);
  assert.equal(d.tenantGrowth.length, 12);
});

test('non-super-admin cannot access the platform dashboard', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/admin/dashboard').set(auth(tokens.owner));
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Tenant dashboard — role-based scoping
// ---------------------------------------------------------------------------

test('company admin dashboard is scoped to their own company', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  insertLead(db, seed.companyId);
  const beta = db.prepare("SELECT id FROM companies WHERE name = 'Beta Inc'").get();
  insertLead(db, beta.id);
  insertLead(db, beta.id);

  const res = await request.get('/api/dashboard/summary').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.company.id, seed.companyId);
  assert.equal(kpiValue(d, 'leads'), 1);
});

test('sales manager dashboard is scoped to their teams', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertLead(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha });
  insertLead(db, seed.companyId, { assignedTo: ids.exec2, teamId: ids.teamBeta });

  const res = await request.get('/api/dashboard/summary').set(auth(tokens.manager));
  assert.equal(res.status, 200);
  assert.equal(kpiValue(res.body.data, 'leads'), 1);
});

test('sales executive dashboard is scoped to themselves', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertLead(db, seed.companyId, { assignedTo: ids.exec1 });
  insertLead(db, seed.companyId, { assignedTo: ids.exec2 });

  const res = await request.get('/api/dashboard/summary').set(auth(tokens.exec1));
  assert.equal(res.status, 200);
  assert.equal(kpiValue(res.body.data, 'leads'), 1);
});

test('accountant dashboard surfaces collection metrics', async () => {
  const { request, seed, db } = await setupHierarchy();
  createUserInCompany(db, seed.companyId, { name: 'Accountant', email: 'acct@a.test', password: 'AcctPass123!', roleKey: 'accountant' });
  const acct = await loginToken(request, 'acct@a.test', 'AcctPass123!');

  const customerId = insertCustomer(db, seed.companyId);
  const inv = insertInvoice(db, seed.companyId, { customerId, amount: 5000 });
  insertPayment(db, seed.companyId, { invoiceId: inv, customerId, amount: 2000, date: currentMonthDate(15) });

  const res = await request.get('/api/dashboard/summary').set(auth(acct));
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.role, 'accountant');
  assert.equal(kpiValue(d, 'invoiced'), 5000);
  assert.equal(kpiValue(d, 'collected'), 2000);
  assert.equal(kpiValue(d, 'outstanding'), 3000);
});

test('viewer can view a read-only dashboard', async () => {
  const { request, seed, db } = await setupHierarchy();
  createUserInCompany(db, seed.companyId, { name: 'Viewer', email: 'viewer@a.test', password: 'ViewerPass123!', roleKey: 'viewer' });
  const viewer = await loginToken(request, 'viewer@a.test', 'ViewerPass123!');
  const res = await request.get('/api/dashboard/summary').set(auth(viewer));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.role, 'viewer');
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation & tenant context
// ---------------------------------------------------------------------------

test('tenant dashboard ignores a client-supplied companyId', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const beta = db.prepare("SELECT id FROM companies WHERE name = 'Beta Inc'").get();

  const res = await request
    .get(`/api/dashboard/summary?companyId=${beta.id}`)
    .set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.companyId, seed.companyId);
});

test('super admin must supply a companyId for the tenant dashboard', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/dashboard/summary').set(auth(tokens.admin));
  assert.equal(res.status, 400);
});

test('sales trend reflects current-month won revenue', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 15000, closeDate: currentMonthDate(10) });

  const res = await request.get('/api/dashboard/summary').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.equal(kpiValue(res.body.data, 'monthlySales'), 15000);
  const salesTrend = res.body.data.charts.salesTrend.series[0].values;
  assert.equal(salesTrend[salesTrend.length - 1], 15000);
});
