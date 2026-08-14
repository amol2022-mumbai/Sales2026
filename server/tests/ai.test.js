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

// ---------------------------------------------------------------------------
// Test helpers (dates are computed relative to "now" so the suite is stable
// regardless of the wall-clock date it runs on).
// ---------------------------------------------------------------------------
const now = new Date();
const today = now.toISOString().slice(0, 10);
const month = today.slice(0, 7);
const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
const monthStart = `${month}-01`;
const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

async function setupHierarchy() {
  const { request, db, seed } = initTestApp();
  const a = seed.companyId;

  const owner = createUserInCompany(db, a, { name: 'Owner', email: 'owner@a.test', password: 'OwnerPass123!', roleKey: 'business_owner' });
  const manager = createUserInCompany(db, a, { name: 'Manager', email: 'manager@a.test', password: 'ManagerPass123!', roleKey: 'sales_manager' });
  const leader = createUserInCompany(db, a, { name: 'Leader', email: 'leader@a.test', password: 'LeaderPass123!', roleKey: 'team_leader' });
  const exec1 = createUserInCompany(db, a, { name: 'Exec One', email: 'exec1@a.test', password: 'Exec1Pass123!', roleKey: 'sales_executive', territory: 'North' });
  const exec2 = createUserInCompany(db, a, { name: 'Exec Two', email: 'exec2@a.test', password: 'Exec2Pass123!', roleKey: 'sales_executive', territory: 'South' });
  const accountant = createUserInCompany(db, a, { name: 'Accountant', email: 'accountant@a.test', password: 'AccPass123!', roleKey: 'accountant' });
  const viewer = createUserInCompany(db, a, { name: 'Viewer', email: 'viewer@a.test', password: 'ViewerPass123!', roleKey: 'viewer' });

  const teamAlpha = createTeam(db, a, { name: 'Team Alpha', leadId: leader, managerId: manager });
  const teamBeta = createTeam(db, a, { name: 'Team Beta' });
  db.prepare('UPDATE users SET team_id = ?, manager_id = ? WHERE id IN (?, ?)').run(teamAlpha, manager, leader, exec1);
  db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(teamBeta, exec2);

  const beta = createCompanyAndUser(db, { companyName: 'Beta Inc', email: 'bob@b.test', password: 'BobPass123!', roleKey: 'business_owner' });

  const tokens = {
    admin: await loginToken(request, 'admin@test.com', 'AdminPass123!'),
    owner: await loginToken(request, 'owner@a.test', 'OwnerPass123!'),
    manager: await loginToken(request, 'manager@a.test', 'ManagerPass123!'),
    leader: await loginToken(request, 'leader@a.test', 'LeaderPass123!'),
    exec1: await loginToken(request, 'exec1@a.test', 'Exec1Pass123!'),
    exec2: await loginToken(request, 'exec2@a.test', 'Exec2Pass123!'),
    accountant: await loginToken(request, 'accountant@a.test', 'AccPass123!'),
    viewer: await loginToken(request, 'viewer@a.test', 'ViewerPass123!'),
    bob: await loginToken(request, 'bob@b.test', 'BobPass123!'),
  };

  return {
    request,
    db,
    seed,
    ids: { owner, manager, leader, exec1, exec2, teamAlpha, teamBeta, betaCompanyId: beta.companyId },
    tokens,
  };
}

function insertOpportunity(db, companyId, { assignedTo = null, teamId = null, stage = 'Won', dealValue = 50000, closeDate = today, probability = 100, customerId = null, targetType = 'lead' }) {
  return Number(
    db
      .prepare(
        `INSERT INTO opportunities (company_id, target_type, customer_id, product_service, deal_value, probability, expected_close_date, assigned_to, team_id, stage, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Medium')`
      )
      .run(companyId, targetType, customerId, null, dealValue, probability, closeDate, assignedTo, teamId, stage).lastInsertRowid
  );
}

function insertLead(db, companyId, { assignedTo = null, teamId = null, nextFollowUp = null }) {
  return Number(
    db
      .prepare(
        `INSERT INTO leads (company_id, company_name, contact_person, status, assigned_to, team_id, next_follow_up, created_at, updated_at)
         VALUES (?, 'Prospect Co', 'Contact', 'New', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      )
      .run(companyId, assignedTo, teamId, nextFollowUp).lastInsertRowid
  );
}

function insertFollowUp(db, companyId, { assignedTo = null, teamId = null, date, status = 'Pending' }) {
  return Number(
    db
      .prepare(
        `INSERT INTO follow_ups (company_id, target_type, activity_type, follow_up_date, status, assigned_to, team_id, created_at, updated_at)
         VALUES (?, 'lead', 'call', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      )
      .run(companyId, date, status, assignedTo, teamId).lastInsertRowid
  );
}

function insertCustomer(db, companyId, name) {
  const result = db
    .prepare(
      `INSERT INTO customers (company_id, name, contact_person, status, created_at, updated_at)
       VALUES (?, ?, 'Contact', 'Active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
    .run(companyId, name);
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE customers SET customer_no = ? WHERE id = ?').run(`CUST-${String(id).padStart(6, '0')}`, id);
  return id;
}

function insertTarget(db, companyId, { userId, targetValue, startDate = monthStart, endDate = monthEnd }) {
  return Number(
    db
      .prepare(
        `INSERT INTO targets (company_id, scope, user_id, target_type, period_type, target_value, start_date, end_date, status)
         VALUES (?, 'user', ?, 'sales', 'monthly', ?, ?, ?, 'Active')`
      )
      .run(companyId, userId, targetValue, startDate, endDate).lastInsertRowid
  );
}

async function ask(request, token, question, extra = {}) {
  return request.post('/api/ai/ask').set(auth(token)).send({ question, ...extra });
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

test('AI assistant is denied for roles without ai_assistant:view', async () => {
  const { request, tokens } = await setupHierarchy();
  for (const role of ['accountant', 'viewer']) {
    const res = await ask(request, tokens[role], 'What were our sales this month?');
    assert.equal(res.status, 403, `expected ${role} to be forbidden`);
  }
});

test('AI assistant is allowed for owner, manager, leader and executive', async () => {
  const { request, tokens } = await setupHierarchy();
  for (const role of ['owner', 'manager', 'leader', 'exec1', 'exec2']) {
    const res = await ask(request, tokens[role], 'What were our sales this month?');
    assert.equal(res.status, 200, `expected ${role} to be allowed`);
  }
});

// ---------------------------------------------------------------------------
// Correctness of real-data answers
// ---------------------------------------------------------------------------

test('sales this month sums scoped won deal values', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 10000, closeDate: today });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec2, teamId: ids.teamBeta, dealValue: 20000, closeDate: today });

  const owner = await ask(request, tokens.owner, 'What were our sales this month?');
  assert.equal(owner.body.data.facts.sales, 30000);

  const leader = await ask(request, tokens.leader, 'What were our sales this month?');
  assert.equal(leader.body.data.facts.sales, 10000);

  const exec1 = await ask(request, tokens.exec1, 'What were our sales this month?');
  assert.equal(exec1.body.data.facts.sales, 10000);

  const exec2 = await ask(request, tokens.exec2, 'What were our sales this month?');
  assert.equal(exec2.body.data.facts.sales, 20000);
});

test('pipeline value and weighted value are computed from open deals', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, stage: 'Negotiation', dealValue: 60000, probability: 50, closeDate: today });

  const res = await ask(request, tokens.owner, 'What is our open pipeline value?');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.facts.openCount, 1);
  assert.equal(res.body.data.facts.openValue, 60000);
  assert.equal(res.body.data.facts.weightedValue, 30000);
});

test('overdue follow-ups are counted and reported', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertFollowUp(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, date: yesterday });
  insertFollowUp(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, date: yesterday });
  insertFollowUp(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, date: today, status: 'Pending' });

  const res = await ask(request, tokens.owner, 'Show me overdue follow-ups');
  assert.equal(res.body.data.facts.overdue, 2);
  assert.equal(res.body.data.facts.items.length, 2);
});

test('leads to contact today includes follow-ups and next_follow_up leads', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertFollowUp(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, date: today });
  insertLead(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, nextFollowUp: today });

  const res = await ask(request, tokens.owner, 'Which leads should I contact today?');
  assert.equal(res.body.data.facts.followUps, 1);
  assert.equal(res.body.data.facts.leads, 1);
});

test('top customers are ranked by won revenue', async () => {
  const { request, tokens, seed, db } = await setupHierarchy();
  const c1 = insertCustomer(db, seed.companyId, 'Acme Ltd');
  const c2 = insertCustomer(db, seed.companyId, 'Globex Corp');
  insertOpportunity(db, seed.companyId, { customerId: c1, targetType: 'customer', dealValue: 5000, closeDate: today });
  insertOpportunity(db, seed.companyId, { customerId: c2, targetType: 'customer', dealValue: 9000, closeDate: today });

  const res = await ask(request, tokens.owner, 'Who are our top customers?');
  const top = res.body.data.facts.topCustomers;
  assert.equal(top[0].name, 'Globex Corp');
  assert.equal(top[0].value, 9000);
  assert.equal(top[1].name, 'Acme Ltd');
  assert.equal(top[1].value, 5000);
});

test('below-target salespeople are identified from real targets', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertTarget(db, seed.companyId, { userId: ids.exec1, targetValue: 100000 });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 40000, closeDate: today });

  const res = await ask(request, tokens.owner, 'Which salespeople are below target?');
  const below = res.body.data.facts.belowTarget;
  assert.equal(below.length, 1);
  assert.equal(below[0].name, 'Exec One');
  assert.equal(below[0].achievement, 40000);
  assert.equal(below[0].achievementPct, 40);
});

test('month-over-month comparison is computed from won deals', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 5000, closeDate: firstOfLastMonth });
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 15000, closeDate: today });

  const res = await ask(request, tokens.owner, 'How do sales compare month over month?');
  assert.equal(res.body.data.facts.sales, 15000);
  assert.equal(res.body.data.facts.previousSales, 5000);
  assert.equal(res.body.data.facts.change, 10000);
  assert.equal(res.body.data.facts.changePct, 200);
});

// ---------------------------------------------------------------------------
// Tenant isolation & security
// ---------------------------------------------------------------------------

test('AI answers are tenant-isolated across companies', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 10000, closeDate: today });
  insertOpportunity(db, ids.betaCompanyId, { dealValue: 99999, closeDate: today });

  const owner = await ask(request, tokens.owner, 'What were our sales this month?');
  assert.equal(owner.body.data.facts.sales, 10000);

  const bob = await ask(request, tokens.bob, 'What were our sales this month?');
  assert.equal(bob.body.data.facts.sales, 99999);
});

test('non-super-admin cannot inject another companyId', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 10000, closeDate: today });
  insertOpportunity(db, ids.betaCompanyId, { dealValue: 99999, closeDate: today });

  const res = await ask(request, tokens.owner, 'What were our sales this month?', { companyId: ids.betaCompanyId });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.facts.sales, 10000);
});

test('super admin must supply companyId for AI answers', async () => {
  const { request, tokens } = await setupHierarchy();
  const missing = await ask(request, tokens.admin, 'What were our sales this month?');
  assert.equal(missing.status, 400);
});

test('super admin can ask for a specific company', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 12345, closeDate: today });

  const res = await ask(request, tokens.admin, 'What were our sales this month?', { companyId: seed.companyId });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.facts.sales, 12345);
});

test('conversation history is scoped to its user and company', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 10000, closeDate: today });

  const created = await ask(request, tokens.owner, 'What were our sales this month?');
  const conversationId = created.body.data.conversationId;

  const ownerList = await request.get('/api/ai/conversations').set(auth(tokens.owner));
  assert.ok(ownerList.body.data.some((c) => c.id === conversationId));

  const bobList = await request.get('/api/ai/conversations').set(auth(tokens.bob));
  assert.ok(!bobList.body.data.some((c) => c.id === conversationId));

  const ownerGet = await request.get(`/api/ai/conversations/${conversationId}`).set(auth(tokens.owner));
  assert.equal(ownerGet.status, 200);
  assert.equal(ownerGet.body.data.messages.length, 2);

  const bobGet = await request.get(`/api/ai/conversations/${conversationId}`).set(auth(tokens.bob));
  assert.equal(bobGet.status, 404);
});

// ---------------------------------------------------------------------------
// Graceful fallback & usage logging (no provider configured in tests)
// ---------------------------------------------------------------------------

test('answer is produced without an LLM key and usage is logged without the prompt', async () => {
  const { request, tokens, seed, db, ids } = await setupHierarchy();
  insertOpportunity(db, seed.companyId, { assignedTo: ids.exec1, teamId: ids.teamAlpha, dealValue: 10000, closeDate: today });

  const question = 'What were our sales this month?';
  const res = await ask(request, tokens.owner, question);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.providerUsed, false);
  assert.ok(res.body.data.message.content.length > 0);
  assert.equal(res.body.data.facts.sales, 10000);

  const log = db.prepare('SELECT * FROM ai_usage_logs ORDER BY id DESC LIMIT 1').get();
  assert.equal(log.action, 'ai.ask');
  assert.equal(log.status, 'ok');
  assert.equal(log.provider, null);
  assert.equal(log.model, null);
  assert.equal(log.prompt_chars, question.length);
  // The usage log must not persist the raw question.
  assert.ok(!JSON.stringify(log).includes(question));
});

// ---------------------------------------------------------------------------
// Admin AI management (super-admin only, no secrets)
// ---------------------------------------------------------------------------

test('AI status is super-admin only and never exposes the key', async () => {
  const { request, tokens } = await setupHierarchy();

  const owner = await request.get('/api/admin/ai/status').set(auth(tokens.owner));
  assert.equal(owner.status, 403);

  const admin = await request.get('/api/admin/ai/status').set(auth(tokens.admin));
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.configured, false);
  assert.equal(admin.body.data.keyConfigured, false);
  assert.ok(!JSON.stringify(admin.body.data).includes('AI_API_KEY'));
  assert.ok(!('apiKey' in admin.body.data));
});

test('AI connectivity test reports not-configured without a key', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.post('/api/admin/ai/test').set(auth(tokens.admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.ok, false);
  assert.equal(res.body.data.reason, 'not_configured');
});
