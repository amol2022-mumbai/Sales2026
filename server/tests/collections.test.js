import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initTestApp,
  loginToken,
  createCompanyAndUser,
  createUserInCompany,
  createTeam,
} from './helpers.js';

/**
 * Phase 10 collections hierarchy (mirrors targets.test.js):
 * Company A: owner, manager (manages Team Alpha), leader (leads Team Alpha),
 *   exec1 (Team Alpha), exec2 (Team Beta).
 * Company B: bob (business_owner).
 */
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

function insertCustomer(db, companyId, { assignedTo = null, teamId = null, name = 'Customer Co' } = {}) {
  const result = db
    .prepare(
      `INSERT INTO customers (company_id, name, contact_person, assigned_to, team_id, created_at, updated_at)
       VALUES (?, ?, 'Contact Person', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
    .run(companyId, name, assignedTo, teamId);
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE customers SET customer_no = ? WHERE id = ?').run(`CUST-${String(id).padStart(6, '0')}`, id);
  return id;
}

test('owner creates an invoice with derived Unpaid status and balance', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);

  const res = await request
    .post('/api/collections')
    .set(auth(tokens.owner))
    .send({ customerId, amount: 5000, dueDate: '2026-09-15' });

  assert.equal(res.status, 201);
  const inv = res.body.data;
  assert.match(inv.invoiceNo, /^INV-\d{6}$/);
  assert.equal(inv.status, 'Unpaid');
  assert.equal(inv.balance, 5000);
  assert.equal(inv.paid, 0);
});

test('recording a payment recomputes status and balance', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);
  const created = await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 5000, dueDate: '2026-09-15' });
  const invoiceId = created.body.data.id;

  const pay = await request
    .post('/api/collections/payments')
    .set(auth(tokens.owner))
    .send({ invoiceId, amount: 3000, paymentDate: '2026-08-20' });

  assert.equal(pay.status, 201);
  assert.match(pay.body.data.paymentNo, /^PAY-\d{6}$/);

  const got = await request.get(`/api/collections/${invoiceId}`).set(auth(tokens.owner));
  assert.equal(got.body.data.status, 'Partial');
  assert.equal(got.body.data.balance, 2000);
  assert.equal(got.body.data.paid, 3000);
  assert.equal(got.body.data.payments.length, 1);

  const pay2 = await request
    .post('/api/collections/payments')
    .set(auth(tokens.owner))
    .send({ invoiceId, amount: 2000, paymentDate: '2026-08-21' });

  assert.equal(pay2.status, 201);
  const got2 = await request.get(`/api/collections/${invoiceId}`).set(auth(tokens.owner));
  assert.equal(got2.body.data.status, 'Paid');
  assert.equal(got2.body.data.balance, 0);
  assert.equal(got2.body.data.paid, 5000);
});

test('deleting a payment reverses the balance', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);
  const created = await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 5000, dueDate: '2026-09-15' });
  const invoiceId = created.body.data.id;
  const pay = await request.post('/api/collections/payments').set(auth(tokens.owner)).send({ invoiceId, amount: 3000, paymentDate: '2026-08-20' });

  const del = await request.delete(`/api/collections/payments/${pay.body.data.id}`).set(auth(tokens.owner));
  assert.equal(del.status, 200);

  const got = await request.get(`/api/collections/${invoiceId}`).set(auth(tokens.owner));
  assert.equal(got.body.data.status, 'Unpaid');
  assert.equal(got.body.data.balance, 5000);
});

test('list filters invoices by status including derived Overdue', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);
  await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 1000, dueDate: '2020-01-01' });
  await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 2000, dueDate: '2999-01-01' });

  const overdue = await request.get('/api/collections?status=Overdue').set(auth(tokens.owner));
  assert.equal(overdue.status, 200);
  assert.equal(overdue.body.data.length, 1);
  assert.equal(overdue.body.data[0].amount, 1000);
  assert.equal(overdue.body.data[0].overdue, true);

  const unpaid = await request.get('/api/collections?status=Unpaid').set(auth(tokens.owner));
  assert.equal(unpaid.body.data.length, 2);
});

test('collections dashboard computes invoiced, collected, outstanding and aging from real data', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);
  const inv1 = await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 10000, dueDate: '2020-01-01' });
  await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 5000, dueDate: '2026-09-15' });
  await request.post('/api/collections/payments').set(auth(tokens.owner)).send({ invoiceId: inv1.body.data.id, amount: 4000, paymentDate: '2026-08-20' });

  const res = await request.get('/api/collections/dashboard').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.invoiced, 15000);
  assert.equal(d.collected, 4000);
  assert.equal(d.outstanding, 11000);
  assert.equal(d.invoiceCount, 2);
  const aging = d.aging.reduce((s, b) => s + b.amount, 0);
  assert.equal(aging, 11000);
});

test('team leader sees only invoices in their team', async () => {
  const { request, tokens, ids, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);
  const mine = await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 1000, assignedTo: ids.exec1, teamId: ids.teamAlpha, dueDate: '2026-09-15' });
  const theirs = await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 2000, assignedTo: ids.exec2, teamId: ids.teamBeta, dueDate: '2026-09-15' });

  const list = await request.get('/api/collections').set(auth(tokens.leader));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].id, mine.body.data.id);

  const other = await request.get(`/api/collections/${theirs.body.data.id}`).set(auth(tokens.leader));
  assert.equal(other.status, 403);
});

test('other-company owner cannot access invoices', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);
  const created = await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 1000, dueDate: '2026-09-15' });

  const get = await request.get(`/api/collections/${created.body.data.id}`).set(auth(tokens.bob));
  assert.equal(get.status, 403);
});

test('invoice and payment mutations write audit logs', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const customerId = insertCustomer(db, seed.companyId);
  const created = await request.post('/api/collections').set(auth(tokens.owner)).send({ customerId, amount: 1000, dueDate: '2026-09-15' });
  await request.post('/api/collections/payments').set(auth(tokens.owner)).send({ invoiceId: created.body.data.id, amount: 1000, paymentDate: '2026-08-20' });

  const rows = db.prepare("SELECT action FROM audit_logs WHERE entity_type = 'invoice' OR entity_type = 'payment'").all();
  const actions = rows.map((r) => r.action);
  assert.ok(actions.includes('invoice.create'));
  assert.ok(actions.includes('payment.create'));
});
