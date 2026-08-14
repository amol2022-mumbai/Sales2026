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
 * Phase 7 target hierarchy (mirrors opportunities.test.js):
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
  const exec1 = createUserInCompany(db, a, { name: 'Exec One', email: 'exec1@a.test', password: 'Exec1Pass123!', roleKey: 'sales_executive', employeeId: 'E001', territory: 'North' });
  const exec2 = createUserInCompany(db, a, { name: 'Exec Two', email: 'exec2@a.test', password: 'Exec2Pass123!', roleKey: 'sales_executive', employeeId: 'E002', territory: 'South' });

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

const targetBody = (overrides = {}) => ({
  scope: 'company',
  targetType: 'sales',
  periodType: 'monthly',
  targetValue: 100000,
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  ...overrides,
});

function insertOpportunity(db, companyId, { assignedTo = null, teamId = null, stage = 'Won', dealValue = 50000, productService = null, closeDate = '2026-08-15' }) {
  return Number(
    db.prepare(
      `INSERT INTO opportunities (company_id, target_type, product_service, deal_value, probability, expected_close_date, assigned_to, team_id, stage, priority)
       VALUES (?, 'lead', ?, ?, 100, ?, ?, ?, ?, 'Medium')`
    ).run(companyId, productService, dealValue, closeDate, assignedTo, teamId, stage).lastInsertRowid
  );
}

function insertLead(db, companyId, { assignedTo = null, teamId = null, productService = null, createdAt = '2026-08-10 10:00:00' }) {
  return Number(
    db.prepare(
      `INSERT INTO leads (company_id, company_name, contact_person, product_service, assigned_to, team_id, created_at, updated_at)
       VALUES (?, 'Prospect Co', 'Contact Person', ?, ?, ?, ?, ?)`
    ).run(companyId, productService, assignedTo, teamId, createdAt, createdAt).lastInsertRowid
  );
}

function insertCustomer(db, companyId, { assignedTo = null, teamId = null, createdAt = '2026-08-11 10:00:00' }) {
  return Number(
    db.prepare(
      `INSERT INTO customers (company_id, name, contact_person, assigned_to, team_id, created_at, updated_at)
       VALUES (?, 'Customer Co', 'Contact Person', ?, ?, ?, ?)`
    ).run(companyId, assignedTo, teamId, createdAt, createdAt).lastInsertRowid
  );
}

function insertFollowUp(db, companyId, { assignedTo = null, teamId = null, status = 'Completed', date = '2026-08-12' }) {
  return Number(
    db.prepare(
      `INSERT INTO follow_ups (company_id, target_type, activity_type, follow_up_date, status, assigned_to, team_id)
       VALUES (?, 'lead', 'call', ?, ?, ?, ?)`
    ).run(companyId, date, status, assignedTo, teamId).lastInsertRowid
  );
}

async function createTarget(request, token, body) {
  const res = await request.post('/api/targets').set(auth(token)).send(targetBody(body));
  return res;
}

// ---------------------------------------------------------------------------
// Create / read / update / delete
// ---------------------------------------------------------------------------

test('owner can create a company target and the target number is TGT-######', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await createTarget(request, tokens.owner, {});
  assert.equal(res.status, 201);
  const t = res.body.data;
  assert.match(t.targetNo, /^TGT-\d{6}$/);
  assert.equal(t.scope, 'company');
  assert.equal(t.targetType, 'sales');
  assert.equal(t.periodType, 'monthly');
  assert.equal(t.targetValue, 100000);
  assert.equal(t.status, 'Active');
});

test('sales executive cannot create a company-level target without targets:assign', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await createTarget(request, tokens.exec1, {});
  assert.equal(res.status, 403);
});

test('sales executive cannot create any target (targets is read-only for execs)', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await createTarget(request, tokens.exec1, { scope: 'user', userId: ids.exec1 });
  assert.equal(res.status, 403);
});

test('sales executive cannot create a target for another user', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await createTarget(request, tokens.exec1, { scope: 'user', userId: ids.exec2 });
  assert.equal(res.status, 403);
});

test('manager can create a target for a team member', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await createTarget(request, tokens.manager, { scope: 'user', userId: ids.exec1 });
  assert.equal(res.status, 201);
});

test('manager cannot create a target for a user outside their teams', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await createTarget(request, tokens.manager, { scope: 'user', userId: ids.exec2 });
  assert.equal(res.status, 403);
});

test('owner can create a team target', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await createTarget(request, tokens.owner, { scope: 'team', teamId: ids.teamAlpha });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.teamId, ids.teamAlpha);
});

test('create validates entity and returns 400 on missing salesperson', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await createTarget(request, tokens.owner, { scope: 'user' });
  assert.equal(res.status, 400);
});

test('get target returns achievement and breakdown', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 30000, closeDate: '2026-08-10' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 20000, closeDate: '2026-08-20' });

  const created = await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1 });
  const res = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.owner));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.achievement, 50000);
  assert.equal(res.body.data.balance, 50000);
  assert.equal(res.body.data.achievementPct, 50);
  assert.equal(res.body.data.breakdown.length, 2);
});

test('update target changes value and status', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await createTarget(request, tokens.owner, {});
  const id = created.body.data.id;

  const res = await request.put(`/api/targets/${id}`).set(auth(tokens.owner)).send({ targetValue: 250000, status: 'Completed' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.targetValue, 250000);
  assert.equal(res.body.data.status, 'Completed');
});

test('delete target soft-deletes and hides from list', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await createTarget(request, tokens.owner, {});
  const id = created.body.data.id;

  const del = await request.delete(`/api/targets/${id}`).set(auth(tokens.owner));
  assert.equal(del.status, 200);

  const list = await request.get('/api/targets').set(auth(tokens.owner));
  assert.equal(list.body.data.some((t) => t.id === id), false);

  const get = await request.get(`/api/targets/${id}`).set(auth(tokens.owner));
  assert.equal(get.status, 404);
});

// ---------------------------------------------------------------------------
// Achievement computation (real data)
// ---------------------------------------------------------------------------

test('sales achievement sums won opportunities in the target range', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 40000, closeDate: '2026-08-05' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 10000, closeDate: '2026-08-25' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, stage: 'Lost', dealValue: 99999, closeDate: '2026-08-15' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 88888, closeDate: '2026-07-30' });

  const created = await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetValue: 100000 });
  const res = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.owner));

  assert.equal(res.body.data.achievement, 50000);
});

test('new_leads achievement counts leads created in range', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertLead(db, seed.companyId, { assignedTo: ids.exec1, createdAt: '2026-08-01 09:00:00' });
  insertLead(db, seed.companyId, { assignedTo: ids.exec1, createdAt: '2026-08-31 23:00:00' });
  insertLead(db, seed.companyId, { assignedTo: ids.exec1, createdAt: '2026-07-01 09:00:00' });

  const created = await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetType: 'new_leads', targetValue: 10 });
  const res = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.owner));

  assert.equal(res.body.data.achievement, 2);
});

test('new_customers achievement counts customers created in range', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertCustomer(db, seed.companyId, { assignedTo: ids.exec1, createdAt: '2026-08-11 10:00:00' });
  insertCustomer(db, seed.companyId, { assignedTo: ids.exec1, createdAt: '2026-08-12 10:00:00' });

  const created = await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetType: 'new_customers', targetValue: 5 });
  const res = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.owner));

  assert.equal(res.body.data.achievement, 2);
});

test('conversion_rate achievement is won / closed * 100', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, stage: 'Won', closeDate: '2026-08-10' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, stage: 'Lost', closeDate: '2026-08-10' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, stage: 'Won', closeDate: '2026-08-10' });

  const created = await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetType: 'conversion_rate', targetValue: 80 });
  const res = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.owner));

  assert.equal(res.body.data.achievement, 66.7);
});

test('collection achievement is honestly 0 until a collections module exists', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const created = await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetType: 'collection', targetValue: 50000 });
  const res = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.owner));

  assert.equal(res.body.data.achievement, 0);
  assert.equal(res.body.data.balance, 50000);
});

test('product-scoped new_customers returns 0 (no product dimension on customers)', async () => {
  const { request, tokens, db, seed, ids } = await setupHierarchy();
  insertCustomer(db, seed.companyId, { assignedTo: ids.exec1 });

  const created = await createTarget(request, tokens.owner, { scope: 'product', product: 'Annual license', targetType: 'new_customers', targetValue: 5 });
  const res = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.owner));

  assert.equal(res.body.data.achievement, 0);
});

test('territory-scoped sales achievement filters by user territory', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 15000, closeDate: '2026-08-10' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec2, dealValue: 25000, closeDate: '2026-08-10' });

  const created = await createTarget(request, tokens.owner, { scope: 'territory', territory: 'North', targetValue: 100000 });
  const res = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.owner));

  assert.equal(res.body.data.achievement, 15000);
});

// ---------------------------------------------------------------------------
// Scope & company isolation
// ---------------------------------------------------------------------------

test('sales executive sees only their own targets', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1 });
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec2 });
  await createTarget(request, tokens.owner, { scope: 'company' });

  const list = await request.get('/api/targets').set(auth(tokens.exec1));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].userId, ids.exec1);
});

test('manager sees team, own and company-level targets', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1 });
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec2 });
  await createTarget(request, tokens.owner, { scope: 'company' });

  const list = await request.get('/api/targets').set(auth(tokens.manager));
  const scopes = list.body.data.map((t) => t.scope).sort();
  assert.deepEqual(scopes, ['company', 'user']);
});

test('other-company owner cannot access targets', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await createTarget(request, tokens.owner, { scope: 'company' });

  const get = await request.get(`/api/targets/${created.body.data.id}`).set(auth(tokens.bob));
  assert.equal(get.status, 403);
});

test('super admin can list targets of a specific company', async () => {
  const { request, tokens, seed } = await setupHierarchy();
  await createTarget(request, tokens.owner, { scope: 'company' });

  const list = await request.get(`/api/targets?companyId=${seed.companyId}`).set(auth(tokens.admin));
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length >= 1);
});

// ---------------------------------------------------------------------------
// Dashboard / scorecard / compare
// ---------------------------------------------------------------------------

test('dashboard returns summary, ranking, pipeline and activities from real data', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 40000, closeDate: '2026-08-10' });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, stage: 'New', dealValue: 60000, closeDate: '2026-08-20' });
  insertFollowUp(db, seed.companyId, { assignedTo: ids.exec1, status: 'Completed', date: '2026-08-12' });

  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetValue: 100000 });

  const res = await request.get('/api/targets/dashboard').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.ok(d.summary.totalTargets >= 1);
  assert.equal(d.summary.achievement, 40000);
  assert.equal(d.pipeline.wonValue, 40000);
  assert.equal(d.pipeline.openValue, 60000);
  assert.equal(d.activities.completed, 1);
  assert.equal(d.collections.achieved, 0);
  assert.ok(d.ranking.length >= 1);
  assert.ok(d.byType.length >= 1);
});

test('scorecard returns bucketed series for a salesperson', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 10000, closeDate: '2026-08-10' });
  insertLead(db, seed.companyId, { assignedTo: ids.exec1, createdAt: '2026-08-11 09:00:00' });
  insertFollowUp(db, seed.companyId, { assignedTo: ids.exec1, status: 'Completed', date: '2026-08-12' });

  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetValue: 100000 });

  const res = await request.get(`/api/targets/scorecard?userId=${ids.exec1}&groupBy=month`).set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const s = res.body.data;
  assert.equal(s.user.id, ids.exec1);
  assert.equal(s.totals.sales, 10000);
  assert.equal(s.totals.newLeads, 1);
  assert.equal(s.totals.activities, 1);
  assert.ok(s.series.length >= 1);
});

test('sales executive cannot view another salesperson scorecard', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await request.get(`/api/targets/scorecard?userId=${ids.exec2}`).set(auth(tokens.exec1));
  assert.equal(res.status, 403);
});

test('compare returns team members with belowTarget flag', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 60000, closeDate: '2026-08-10' });
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetValue: 100000 });
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec2, targetValue: 100000 });

  const res = await request.get('/api/targets/compare').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const members = res.body.data.members;
  const byId = Object.fromEntries(members.map((m) => [m.userId, m]));
  assert.equal(byId[ids.exec1].achievementPct, 60);
  assert.equal(byId[ids.exec1].belowTarget, true);
  assert.equal(byId[ids.exec2].belowTarget, true);
});

// ---------------------------------------------------------------------------
// Filters / search / pagination / computed sorts
// ---------------------------------------------------------------------------

test('list filters by targetType, status and search', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetType: 'new_leads' });
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec2, targetType: 'sales', status: 'Paused' });

  const byType = await request.get('/api/targets?targetType=new_leads').set(auth(tokens.owner));
  assert.equal(byType.body.data.length, 1);

  const byStatus = await request.get('/api/targets?status=Paused').set(auth(tokens.owner));
  assert.equal(byStatus.body.data.length, 1);

  const search = await request.get('/api/targets?search=Exec One').set(auth(tokens.owner));
  assert.equal(search.body.data.length, 1);
});

test('list supports computed achievement sort', async () => {
  const { request, tokens, ids, db, seed } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, dealValue: 90000, closeDate: '2026-08-10' });
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1, targetValue: 100000 });
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec2, targetValue: 100000 });

  const res = await request.get('/api/targets?sort=achievement&order=desc').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const items = res.body.data;
  assert.equal(items[0].userId, ids.exec1);
  assert.equal(items[0].achievement, 90000);
});

test('meta returns target enums', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/targets/meta').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.scopes.includes('company'));
  assert.ok(res.body.data.types.includes('sales'));
  assert.ok(res.body.data.periods.includes('monthly'));
  assert.ok(res.body.data.statuses.includes('Active'));
});

test('export returns CSV with headers and rows', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  await createTarget(request, tokens.owner, { scope: 'user', userId: ids.exec1 });

  const res = await request.get('/api/targets/export').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text, /Target ID/);
  assert.match(res.text, /TGT-\d{6}/);
});

test('export requires targets:export permission (viewer denied)', async () => {
  const { request, db, seed, tokens } = await setupHierarchy();
  const viewer = createUserInCompany(db, seed.companyId, { name: 'Viewer', email: 'viewer@a.test', password: 'ViewerPass123!', roleKey: 'viewer' });
  const viewerToken = await loginToken(request, 'viewer@a.test', 'ViewerPass123!');

  const res = await request.get('/api/targets/export').set(auth(viewerToken));
  assert.equal(res.status, 403);
  void viewer;
});

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

test('target create / update / delete write audit logs', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await createTarget(request, tokens.owner, {});
  const id = created.body.data.id;
  await request.put(`/api/targets/${id}`).set(auth(tokens.owner)).send({ targetValue: 500 });
  await request.delete(`/api/targets/${id}`).set(auth(tokens.owner));

  const logs = await request.get('/api/audit-logs').set(auth(tokens.admin));
  const actions = logs.body.data.map((l) => l.action);
  assert.ok(actions.includes('target.create'));
  assert.ok(actions.includes('target.update'));
  assert.ok(actions.includes('target.delete'));
});
