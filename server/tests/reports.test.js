import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initTestApp,
  loginToken,
  createCompanyAndUser,
  createUserInCompany,
  createTeam,
} from './helpers.js';

async function setupHierarchy() {
  const { request, db, seed } = initTestApp();
  const a = seed.companyId;

  const owner = createUserInCompany(db, a, { name: 'Owner', email: 'owner@a.test', password: 'OwnerPass123!', roleKey: 'business_owner' });
  const manager = createUserInCompany(db, a, { name: 'Manager', email: 'manager@a.test', password: 'ManagerPass123!', roleKey: 'sales_manager' });
  const leader = createUserInCompany(db, a, { name: 'Leader', email: 'leader@a.test', password: 'LeaderPass123!', roleKey: 'team_leader' });
  const exec1 = createUserInCompany(db, a, { name: 'Exec One', email: 'exec1@a.test', password: 'Exec1Pass123!', roleKey: 'sales_executive', territory: 'North' });
  const exec2 = createUserInCompany(db, a, { name: 'Exec Two', email: 'exec2@a.test', password: 'Exec2Pass123!', roleKey: 'sales_executive', territory: 'South' });

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

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function insertOpportunity(db, companyId, { assignedTo = null, teamId = null, stage = 'Won', dealValue = 50000, closeDate = '2026-08-15', probability = 100, product = null }) {
  return Number(
    db.prepare(
      `INSERT INTO opportunities (company_id, target_type, product_service, deal_value, probability, expected_close_date, assigned_to, team_id, stage, priority)
       VALUES (?, 'lead', ?, ?, ?, ?, ?, ?, ?, 'Medium')`
    ).run(companyId, product, dealValue, probability, closeDate, assignedTo, teamId, stage).lastInsertRowid
  );
}

function insertLead(db, companyId, { assignedTo = null, teamId = null, status = 'New', createdAt = '2026-08-10 10:00:00' }) {
  return Number(
    db.prepare(
      `INSERT INTO leads (company_id, company_name, contact_person, status, assigned_to, team_id, created_at, updated_at)
       VALUES (?, 'Prospect Co', 'Contact', ?, ?, ?, ?, ?)`
    ).run(companyId, status, assignedTo, teamId, createdAt, createdAt).lastInsertRowid
  );
}

function insertCustomer(db, companyId, { assignedTo = null, teamId = null, name = 'Customer Co' } = {}) {
  const result = db
    .prepare(
      `INSERT INTO customers (company_id, name, contact_person, assigned_to, team_id, created_at, updated_at)
       VALUES (?, ?, 'Contact', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
    .run(companyId, name, assignedTo, teamId);
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE customers SET customer_no = ? WHERE id = ?').run(`CUST-${String(id).padStart(6, '0')}`, id);
  return id;
}

function insertInvoice(db, companyId, { customerId, assignedTo = null, teamId = null, amount = 5000, dueDate = '2026-09-15' }) {
  const result = db
    .prepare(
      `INSERT INTO invoices (company_id, customer_id, amount, due_date, status, assigned_to, team_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Unpaid', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
    .run(companyId, customerId, amount, dueDate, assignedTo, teamId);
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE invoices SET invoice_no = ? WHERE id = ?').run(`INV-${String(id).padStart(6, '0')}`, id);
  return id;
}

function insertPayment(db, companyId, { invoiceId, customerId, amount = 5000, date = '2026-08-20' }) {
  return Number(
    db.prepare(
      `INSERT INTO payments (company_id, invoice_id, customer_id, amount, payment_date, method, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Bank Transfer', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).run(companyId, invoiceId, customerId, amount, date).lastInsertRowid
  );
}

// ---------------------------------------------------------------------------
// Report catalogue & accuracy
// ---------------------------------------------------------------------------

test('report types endpoint lists every report type', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/reports/types').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const keys = res.body.data.map((r) => r.key);
  assert.equal(keys.length, 12);
  for (const k of ['sales', 'collections', 'aging', 'lead-conversion', 'pipeline', 'target-achievement', 'productivity']) {
    assert.ok(keys.includes(k));
  }
});

test('sales report sums won deal values from real data', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 40000, closeDate: '2026-08-15' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec2, dealValue: 10000, closeDate: '2026-07-20' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, stage: 'Negotiation', dealValue: 99999, closeDate: '2026-08-15' });

  const total = await request.get('/api/reports/sales').set(auth(tokens.owner));
  assert.equal(total.status, 200);
  assert.equal(total.body.data.rows.length, 1);
  assert.equal(total.body.data.rows[0].period, 'Total');
  assert.equal(total.body.data.rows[0].sales, 50000);
  assert.equal(total.body.data.rows[0].count, 2);

  const monthly = await request.get('/api/reports/sales?period=month').set(auth(tokens.owner));
  const rows = monthly.body.data.rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].period, '2026-07');
  assert.equal(rows[0].sales, 10000);
  assert.equal(rows[1].period, '2026-08');
  assert.equal(rows[1].sales, 40000);
});

test('collections and aging reports use real invoice and payment data', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);
  const inv1 = insertInvoice(db, seed.companyId, { customerId, amount: 5000, dueDate: '2020-01-01' });
  insertPayment(db, seed.companyId, { invoiceId: inv1, customerId, amount: 2000, date: '2026-08-20' });
  insertInvoice(db, seed.companyId, { customerId, amount: 10000, dueDate: '2999-01-01' });

  const collections = await request.get('/api/reports/collections').set(auth(tokens.owner));
  assert.equal(collections.body.data.rows[0].collected, 2000);
  assert.equal(collections.body.data.rows[0].payments, 1);

  const aging = await request.get('/api/reports/aging').set(auth(tokens.owner));
  const buckets = Object.fromEntries(aging.body.data.rows.map((r) => [r.bucket, r.outstanding]));
  assert.equal(buckets['Not due'], 10000);
  assert.equal(buckets['90+ days'], 3000);
});

test('lead-conversion report computes conversion from lead statuses', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  insertLead(db, seed.companyId, { status: 'Won' });
  insertLead(db, seed.companyId, { status: 'Lost' });
  insertLead(db, seed.companyId, { status: 'New' });

  const res = await request.get('/api/reports/lead-conversion').set(auth(tokens.owner));
  const row = res.body.data.rows[0];
  assert.equal(row.leads, 3);
  assert.equal(row.won, 1);
  assert.equal(row.lost, 1);
  assert.equal(row.conversionRate, 50);
});

// ---------------------------------------------------------------------------
// Scope & cross-tenant isolation
// ---------------------------------------------------------------------------

test('team leader report only includes their team, not the whole company', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 10000, closeDate: '2026-08-15' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec2, teamId: ids.teamBeta, dealValue: 20000, closeDate: '2026-08-15' });

  const leader = await request.get('/api/reports/sales').set(auth(tokens.leader));
  assert.equal(leader.status, 200);
  assert.equal(leader.body.data.rows[0].sales, 10000);

  const owner = await request.get('/api/reports/sales').set(auth(tokens.owner));
  assert.equal(owner.body.data.rows[0].sales, 30000);
});

test('cross-tenant: owner never sees another company in reports', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 10000, closeDate: '2026-08-15' });
  // Beta Inc opportunity via direct insert into a different company.
  const betaCompany = db.prepare("SELECT id FROM companies WHERE name = 'Beta Inc'").get().id;
  insertOpportunity(db, betaCompany, { dealValue: 99999, closeDate: '2026-08-15' });

  const res = await request.get('/api/reports/sales').set(auth(tokens.owner));
  assert.equal(res.body.data.rows[0].sales, 10000);

  const bob = await request.get('/api/reports/sales').set(auth(tokens.bob));
  assert.equal(bob.body.data.rows[0].sales, 99999);
});

test('super admin must supply companyId for reports', async () => {
  const { request, tokens } = await setupHierarchy();
  const missing = await request.get('/api/reports/sales').set(auth(tokens.admin));
  assert.equal(missing.status, 400);
});

test('super admin can run a report for a specific company', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 12345, closeDate: '2026-08-15' });

  const res = await request.get(`/api/reports/sales?companyId=${seed.companyId}`).set(auth(tokens.admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.rows[0].sales, 12345);
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

test('export report returns CSV with BOM and header row', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 10000, closeDate: '2026-08-15' });

  const res = await request.get('/api/reports/sales/export?format=csv').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.ok(res.text.startsWith('\uFEFF'));
  assert.ok(res.text.includes('Period'));
});

test('export report returns XLSX spreadsheet', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 10000, closeDate: '2026-08-15' });

  const res = await request.get('/api/reports/sales/export?format=xlsx').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /spreadsheetml/);
  assert.ok((res.text?.length ?? 0) > 0);
});

test('export report returns PDF', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 10000, closeDate: '2026-08-15' });

  const res = await request.get('/api/reports/sales/export?format=pdf').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.ok(res.body.length > 0);
  assert.equal(res.body.slice(0, 4).toString(), '%PDF');
});

// ---------------------------------------------------------------------------
// MIS summary
// ---------------------------------------------------------------------------

test('MIS summary returns accurate tenant-scoped metrics', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertLead(db, seed.companyId, { assignedTo: ids.exec1, createdAt: '2026-08-10 10:00:00' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 40000, closeDate: '2026-08-15' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, stage: 'Negotiation', dealValue: 60000, probability: 50, closeDate: '2026-09-01' });
  const customerId = insertCustomer(db, seed.companyId, { assignedTo: ids.exec1 });
  const inv = insertInvoice(db, seed.companyId, { customerId, assignedTo: ids.exec1, amount: 5000 });
  insertPayment(db, seed.companyId, { invoiceId: inv, customerId, amount: 2000, date: '2026-08-20' });

  const res = await request.get('/api/mis/summary?from=2026-08-01&to=2026-08-31').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.leads.total, 1);
  assert.equal(d.leads.newInPeriod, 1);
  assert.equal(d.sales.wonValue, 40000);
  assert.equal(d.sales.wonCount, 1);
  assert.equal(d.pipeline.openValue, 60000);
  assert.equal(d.pipeline.weightedValue, 30000);
  assert.equal(d.collections.invoiced, 5000);
  assert.equal(d.collections.collected, 2000);
  assert.equal(d.collections.outstanding, 3000);
});

test('sales manager MIS is scoped to their teams', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 10000, closeDate: '2026-08-15' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec2, teamId: ids.teamBeta, dealValue: 20000, closeDate: '2026-08-15' });

  const res = await request.get('/api/mis/summary?from=2026-08-01&to=2026-08-31').set(auth(tokens.manager));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.sales.wonValue, 10000);
});

// ---------------------------------------------------------------------------
// Super Admin platform dashboard
// ---------------------------------------------------------------------------

test('super admin platform dashboard returns cross-tenant analytics', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 10000, closeDate: '2026-08-15' });

  const res = await request.get('/api/admin/dashboard').set(auth(tokens.admin));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.totals.companies >= 2);
  assert.equal(res.body.data.totals.revenue, 10000);
  const names = res.body.data.companies.map((c) => c.name);
  assert.ok(names.includes('Beta Inc'));
  const seedCompany = res.body.data.companies.find((c) => c.id === seed.companyId);
  assert.equal(seedCompany.wonRevenue, 10000);
});

test('non-super-admin cannot access the platform dashboard', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/admin/dashboard').set(auth(tokens.owner));
  assert.equal(res.status, 403);
});
