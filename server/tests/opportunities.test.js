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
 * Reuse the Phase 2 hierarchy to exercise opportunity/pipeline data access:
 *
 * Company A (seed company):
 *   owner (business_owner)
 *   manager (sales_manager)  -> manages Team Alpha
 *   leader (team_leader)     -> leads Team Alpha, member of Team Alpha
 *   exec1 (sales_executive)  -> member of Team Alpha
 *   exec2 (sales_executive)  -> member of Team Beta
 *   Team Alpha: manager=manager, lead=leader
 *   Team Beta:  no manager/lead
 * Company B: bob (business_owner)
 */
async function setupHierarchy() {
  const { request, db, seed } = initTestApp();
  const a = seed.companyId;

  const owner = createUserInCompany(db, a, { name: 'Owner', email: 'owner@a.test', password: 'OwnerPass123!', roleKey: 'business_owner' });
  const manager = createUserInCompany(db, a, { name: 'Manager', email: 'manager@a.test', password: 'ManagerPass123!', roleKey: 'sales_manager' });
  const leader = createUserInCompany(db, a, { name: 'Leader', email: 'leader@a.test', password: 'LeaderPass123!', roleKey: 'team_leader' });
  const exec1 = createUserInCompany(db, a, { name: 'Exec One', email: 'exec1@a.test', password: 'Exec1Pass123!', roleKey: 'sales_executive', employeeId: 'E001' });
  const exec2 = createUserInCompany(db, a, { name: 'Exec Two', email: 'exec2@a.test', password: 'Exec2Pass123!', roleKey: 'sales_executive', employeeId: 'E002' });

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

  return { request, db, ids: { owner, manager, leader, exec1, exec2, teamAlpha, teamBeta }, tokens };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const leadBody = (overrides = {}) => ({
  companyName: 'Acme Corp',
  contactPerson: 'Jane Doe',
  mobile: '+1 555 111 2222',
  email: 'jane@acme.test',
  ...overrides,
});

const customerBody = (overrides = {}) => ({
  name: 'Acme Industries',
  contactPerson: 'Jane Doe',
  email: 'jane@acmeindustries.test',
  mobile: '+1 555 222 3333',
  ...overrides,
});

const opportunityBody = (overrides = {}) => ({
  targetType: 'lead',
  productService: 'Annual license',
  dealValue: 10000,
  probability: 50,
  expectedCloseDate: '2026-08-31',
  ...overrides,
});

async function createLead(request, token, overrides = {}) {
  const res = await request.post('/api/leads').set(auth(token)).send(leadBody(overrides));
  assert.equal(res.status, 201);
  return res.body.data;
}

async function createCustomer(request, token, overrides = {}) {
  const res = await request.post('/api/customers').set(auth(token)).send(customerBody(overrides));
  assert.equal(res.status, 201);
  return res.body.data;
}

async function createOpportunity(request, token, overrides = {}) {
  const res = await request.post('/api/pipeline').set(auth(token)).send(opportunityBody(overrides));
  assert.equal(res.status, 201);
  return res.body.data;
}

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------

test('business owner can create an opportunity linked to a lead', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);

  const res = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, contactPerson: 'Jane Doe', assignedTo: ids.exec1 })
  );

  assert.equal(res.status, 201);
  const o = res.body.data;
  assert.match(o.opportunityNo, /^OPP-\d{6}$/);
  assert.equal(o.targetType, 'lead');
  assert.equal(o.leadId, lead.id);
  assert.equal(o.targetName, 'Acme Corp');
  assert.equal(o.dealValue, 10000);
  assert.equal(o.probability, 50);
  assert.equal(o.weightedValue, 5000);
  assert.equal(o.stage, 'New');
  assert.equal(o.priority, 'Medium');
  assert.equal(o.assignedTo, ids.exec1);
  assert.equal(o.assignedName, 'Exec One');
  assert.equal(o.teamId, ids.teamAlpha);
});

test('opportunity can be linked to a customer and defaults to self-assignment', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const customer = await createCustomer(request, tokens.exec1);

  const res = await request.post('/api/pipeline').set(auth(tokens.exec1)).send({
    targetType: 'customer',
    targetId: customer.id,
    productService: 'Consulting',
    dealValue: 25000,
    probability: 80,
  });

  assert.equal(res.status, 201);
  const o = res.body.data;
  assert.equal(o.targetType, 'customer');
  assert.equal(o.customerId, customer.id);
  assert.equal(o.targetName, 'Acme Industries');
  assert.equal(o.assignedTo, ids.exec1);
  assert.equal(o.stage, 'New');
  assert.equal(o.priority, 'Medium');
  assert.equal(o.probability, 80);
  assert.equal(o.weightedValue, 20000);
});

test('opportunity creation is rejected without target fields', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.post('/api/pipeline').set(auth(tokens.owner)).send({ productService: 'X' });
  assert.equal(res.status, 400);
});

test('opportunity creation rejects an invalid stage and out-of-range probability', async () => {
  const { request, tokens } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);

  const badStage = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, stage: 'Closed' })
  );
  assert.equal(badStage.status, 400);

  const badProb = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, probability: 150 })
  );
  assert.equal(badProb.status, 400);
});

test('opportunity creation is rejected for a target outside the user scope', async () => {
  const { request, tokens } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const res = await request.post('/api/pipeline').set(auth(tokens.exec2)).send(
    opportunityBody({ targetId: lead.id })
  );
  assert.equal(res.status, 403);
});

test('get opportunity returns detail, activities and follow-ups', async () => {
  const { request, tokens, ids, db } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner })
  );
  const id = created.body.data.id;

  await request.post('/api/follow-ups').set(auth(tokens.owner)).send({
    targetType: 'lead',
    targetId: lead.id,
    activityType: 'call',
    followUpDate: '2026-04-01',
    assignedTo: ids.owner,
  });

  const res = await request.get(`/api/pipeline/${id}`).set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const o = res.body.data;
  assert.equal(o.id, id);
  assert.ok(Array.isArray(o.activities));
  assert.ok(o.activities.some((a) => a.type === 'created'));
  assert.equal(o.followUps.length, 1);

  const mirror = db.prepare('SELECT COUNT(*) AS c FROM lead_activities WHERE lead_id = ? AND type = ?').get(lead.id, 'opportunity').c;
  assert.ok(mirror >= 1);
});

// ---------------------------------------------------------------------------
// Update / stage / note / value change
// ---------------------------------------------------------------------------

test('update changes fields and logs a value-change audit', async () => {
  const { request, tokens, ids, db } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner })
  );
  const id = created.body.data.id;

  const res = await request.put(`/api/pipeline/${id}`).set(auth(tokens.owner)).send({
    dealValue: 12000,
    probability: 75,
    priority: 'High',
  });

  assert.equal(res.status, 200);
  const o = res.body.data;
  assert.equal(o.dealValue, 12000);
  assert.equal(o.probability, 75);
  assert.equal(o.priority, 'High');
  assert.equal(o.weightedValue, 9000);

  const audit = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'pipeline.value_change' AND entity_id = ?").get(String(id)).c;
  assert.ok(audit >= 1);
});

test('move stage records a stage-change audit and timeline entry', async () => {
  const { request, tokens, ids, db } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner })
  );
  const id = created.body.data.id;

  const res = await request.post(`/api/pipeline/${id}/stage`).set(auth(tokens.owner)).send({ stage: 'Qualified' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.stage, 'Qualified');

  const audit = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'pipeline.stage_change' AND entity_id = ?").get(String(id)).c;
  assert.ok(audit >= 1);

  const activity = db.prepare('SELECT COUNT(*) AS c FROM opportunity_activities WHERE opportunity_id = ? AND type = ?').get(id, 'stage').c;
  assert.ok(activity >= 1);
});

test('add note appends to the opportunity timeline', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner })
  );
  const id = created.body.data.id;

  const res = await request.post(`/api/pipeline/${id}/notes`).set(auth(tokens.owner)).send({ note: 'Follow up next week' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.type, 'note');
  assert.equal(res.body.data.description, 'Follow up next week');
});

// ---------------------------------------------------------------------------
// Assignment control
// ---------------------------------------------------------------------------

test('sales executive cannot assign opportunity to another user', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.exec1 })
  );
  const id = created.body.data.id;

  const res = await request.put(`/api/pipeline/${id}`).set(auth(tokens.exec1)).send({ assignedTo: ids.exec2 });
  assert.equal(res.status, 403);
});

test('manager can assign opportunity within their team', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.exec1 })
  );
  const id = created.body.data.id;

  const res = await request.put(`/api/pipeline/${id}`).set(auth(tokens.manager)).send({ assignedTo: ids.leader });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.assignedTo, ids.leader);
});

// ---------------------------------------------------------------------------
// Dashboard metrics
// ---------------------------------------------------------------------------

test('dashboard reports totals, weighted pipeline, won/lost and conversion rate', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);

  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, dealValue: 10000, probability: 50, stage: 'Qualified' })
  );
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, dealValue: 8000, probability: 25, stage: 'Won' })
  );
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, dealValue: 4000, probability: 10, stage: 'Lost' })
  );

  const res = await request.get('/api/pipeline/dashboard').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.total, 3);
  assert.equal(d.pipelineValue, 10000);
  assert.equal(d.weightedValue, 5000);
  assert.equal(d.wonValue, 8000);
  assert.equal(d.lostValue, 4000);
  assert.equal(d.conversionRate, 50);
});

// ---------------------------------------------------------------------------
// Board + list filtering
// ---------------------------------------------------------------------------

test('board groups opportunities by stage with count and value', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);

  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, dealValue: 10000, probability: 50, stage: 'New' })
  );
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, dealValue: 5000, probability: 20, stage: 'New' })
  );
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, dealValue: 2000, probability: 10, stage: 'Qualified' })
  );

  const res = await request.get('/api/pipeline/board').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const columns = res.body.data.columns;
  const byStage = Object.fromEntries(columns.map((c) => [c.stage, c]));
  assert.equal(byStage.New.count, 2);
  assert.equal(byStage.New.value, 15000);
  assert.equal(byStage.Qualified.count, 1);
});

test('list supports search, filter and pagination', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);

  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, productService: 'Alpha product', stage: 'New' })
  );
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, productService: 'Beta product', stage: 'Qualified' })
  );

  const byStage = await request.get('/api/pipeline?stage=Qualified').set(auth(tokens.owner));
  assert.equal(byStage.status, 200);
  assert.equal(byStage.body.data.length, 1);
  assert.equal(byStage.body.data[0].productService, 'Beta product');

  const bySearch = await request.get('/api/pipeline?search=Alpha').set(auth(tokens.owner));
  assert.equal(bySearch.status, 200);
  assert.equal(bySearch.body.data.length, 1);

  const page1 = await request.get('/api/pipeline?page=1&pageSize=1').set(auth(tokens.owner));
  assert.equal(page1.body.data.length, 1);
  assert.equal(page1.body.meta.total, 2);
  assert.equal(page1.body.meta.totalPages, 2);
});

test('list filters by target type and expected-close date range', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const customer = await createCustomer(request, tokens.owner);

  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner, expectedCloseDate: '2026-08-15' })
  );
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    { targetType: 'customer', targetId: customer.id, productService: 'Services', dealValue: 5000, probability: 40, expectedCloseDate: '2026-10-01', assignedTo: ids.owner }
  );

  const byType = await request.get('/api/pipeline?targetType=customer').set(auth(tokens.owner));
  assert.equal(byType.status, 200);
  assert.equal(byType.body.data.length, 1);
  assert.equal(byType.body.data[0].customerId, customer.id);

  const byDate = await request.get('/api/pipeline?dateFrom=2026-09-01&dateTo=2026-12-31').set(auth(tokens.owner));
  assert.equal(byDate.status, 200);
  assert.equal(byDate.body.data.length, 1);
  assert.equal(byDate.body.data[0].expectedCloseDate, '2026-10-01');
});

// ---------------------------------------------------------------------------
// Scope enforcement
// ---------------------------------------------------------------------------

test('sales executive only sees their own opportunities', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.exec1 })
  );
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.exec2 })
  );

  const res = await request.get('/api/pipeline').set(auth(tokens.exec1));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].assignedTo, ids.exec1);
});

test('team leader sees opportunities for their team', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.exec1 })
  );
  await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.exec2 })
  );

  const res = await request.get('/api/pipeline').set(auth(tokens.leader));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].assignedTo, ids.exec1);
});

test('company B owner cannot access company A opportunity', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner })
  );
  const id = created.body.data.id;

  const res = await request.get(`/api/pipeline/${id}`).set(auth(tokens.bob));
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test('delete opportunity soft-deletes and removes it from lists', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/pipeline').set(auth(tokens.owner)).send(
    opportunityBody({ targetId: lead.id, assignedTo: ids.owner })
  );
  const id = created.body.data.id;

  const del = await request.delete(`/api/pipeline/${id}`).set(auth(tokens.owner));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);

  const res = await request.get(`/api/pipeline/${id}`).set(auth(tokens.owner));
  assert.equal(res.status, 404);
});
