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
 * Reuse the Phase 2 hierarchy to exercise follow-up data access:
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

const followUpBody = (overrides = {}) => ({
  targetType: 'lead',
  activityType: 'call',
  followUpDate: '2026-04-01',
  followUpTime: '10:30',
  priority: 'High',
  notes: 'Discuss proposal',
  nextAction: 'Send quote',
  ...overrides,
});

async function createLead(request, token, overrides = {}) {
  const res = await request.post('/api/leads').set(auth(token)).send(leadBody(overrides));
  assert.equal(res.status, 201);
  return res.body.data;
}

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------

test('business owner can create a follow-up linked to a lead', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);

  const res = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(
    followUpBody({ targetId: lead.id, assignedTo: ids.exec1 })
  );

  assert.equal(res.status, 201);
  const f = res.body.data;
  assert.equal(f.targetType, 'lead');
  assert.equal(f.leadId, lead.id);
  assert.equal(f.targetName, 'Acme Corp');
  assert.equal(f.activityType, 'call');
  assert.equal(f.followUpDate, '2026-04-01');
  assert.equal(f.followUpTime, '10:30');
  assert.equal(f.priority, 'High');
  assert.equal(f.status, 'Pending');
  assert.equal(f.assignedTo, ids.exec1);
  assert.equal(f.assignedName, 'Exec One');
  assert.equal(f.teamId, ids.teamAlpha);
});

test('follow-up defaults priority to Medium and assigns self for non-super-admin', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.exec1);

  const res = await request.post('/api/follow-ups').set(auth(tokens.exec1)).send({
    targetType: 'lead',
    targetId: lead.id,
    activityType: 'note',
    followUpDate: '2026-04-02',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.priority, 'Medium');
  assert.equal(res.body.data.assignedTo, ids.exec1);
  assert.equal(res.body.data.status, 'Pending');
});

test('follow-up creation is rejected without required fields', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.post('/api/follow-ups').set(auth(tokens.owner)).send({ targetType: 'lead' });
  assert.equal(res.status, 400);
});

test('follow-up creation is rejected for a target outside the user scope', async () => {
  const { request, tokens } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const res = await request.post('/api/follow-ups').set(auth(tokens.exec2)).send(
    followUpBody({ targetId: lead.id })
  );
  assert.equal(res.status, 403);
});

test('get follow-up returns full detail and activity is mirrored to lead timeline', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id }));
  const id = created.body.data.id;

  const res = await request.get(`/api/follow-ups/${id}`).set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.id, id);

  const timeline = db.prepare('SELECT COUNT(*) AS c FROM lead_activities WHERE lead_id = ?').get(lead.id);
  assert.ok(timeline.c >= 1);
});

// ---------------------------------------------------------------------------
// Status lifecycle: complete / reschedule / cancel / assign
// ---------------------------------------------------------------------------

test('complete follow-up sets status, completed_at and completed_by', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner }));
  const id = created.body.data.id;

  const res = await request.post(`/api/follow-ups/${id}/complete`).set(auth(tokens.owner)).send({ notes: 'Done deal' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'Completed');
  assert.ok(res.body.data.completedAt);
  assert.equal(res.body.data.completedByName, 'Owner');
});

test('reschedule marks original Rescheduled and creates a new Pending row', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner }));
  const id = created.body.data.id;

  const res = await request.post(`/api/follow-ups/${id}/reschedule`).set(auth(tokens.owner)).send({
    followUpDate: '2026-05-01',
    followUpTime: '09:00',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'Pending');
  assert.equal(res.body.data.followUpDate, '2026-05-01');
  assert.equal(res.body.data.rescheduledFrom, id);

  const original = await request.get(`/api/follow-ups/${id}`).set(auth(tokens.owner));
  assert.equal(original.body.data.status, 'Rescheduled');
});

test('cancel follow-up sets status to Cancelled', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner }));
  const id = created.body.data.id;

  const res = await request.post(`/api/follow-ups/${id}/cancel`).set(auth(tokens.owner)).send({ notes: 'Not needed' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'Cancelled');
});

test('sales executive cannot assign to others (no followups:assign)', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.exec1 }));
  const id = created.body.data.id;

  const res = await request.post(`/api/follow-ups/${id}/assign`).set(auth(tokens.exec1)).send({ assignedTo: ids.exec2 });
  assert.equal(res.status, 403);
});

test('manager can assign follow-up within their team', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.exec1 }));
  const id = created.body.data.id;

  const res = await request.post(`/api/follow-ups/${id}/assign`).set(auth(tokens.manager)).send({ assignedTo: ids.leader });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.assignedTo, ids.leader);
});

// ---------------------------------------------------------------------------
// Overdue derivation + dashboards + calendar
// ---------------------------------------------------------------------------

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('overdue is derived from Pending past-date follow-ups', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(
    followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: dateOffset(-3) })
  );

  const list = await request.get('/api/follow-ups?status=Overdue').set(auth(tokens.owner));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].displayStatus, 'Overdue');
  assert.equal(list.body.data[0].overdue, true);
});

test('dashboard reports today/upcoming/overdue/completed buckets', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: dateOffset(0) }));
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: dateOffset(-1) }));
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: dateOffset(2) }));

  const res = await request.get('/api/follow-ups/dashboard').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.today, 1);
  assert.equal(res.body.data.overdue, 1);
  assert.equal(res.body.data.upcoming, 1);
  assert.equal(res.body.data.total, 3);
});

test('calendar returns follow-ups within the requested range', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: '2026-06-15' }));
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: '2026-06-20' }));

  const res = await request.get('/api/follow-ups/calendar?from=2026-06-01&to=2026-06-16').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].followUpDate, '2026-06-15');
});

// ---------------------------------------------------------------------------
// Scope enforcement
// ---------------------------------------------------------------------------

test('sales executive only sees their own follow-ups', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.exec1 }));
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.exec2 }));

  const res = await request.get('/api/follow-ups').set(auth(tokens.exec1));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].assignedTo, ids.exec1);
});

test('team leader sees follow-ups for their team and self', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.exec1 }));
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.exec2 }));

  const res = await request.get('/api/follow-ups').set(auth(tokens.leader));
  assert.equal(res.status, 200);
  const assigned = res.body.data.map((i) => i.assignedTo);
  assert.deepEqual(assigned, [ids.exec1]);
});

test('company B owner cannot access company A follow-up', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner }));
  const id = created.body.data.id;

  const res = await request.get(`/api/follow-ups/${id}`).set(auth(tokens.bob));
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Reminders / notifications
// ---------------------------------------------------------------------------

test('reminder sweep generates notifications for overdue and upcoming follow-ups', async () => {
  const { request, tokens, ids, db } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: dateOffset(-2) }));
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: dateOffset(1) }));
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: dateOffset(10) }));

  const res = await request.post('/api/follow-ups/reminders').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.created, 2);

  const count = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?').get(ids.owner).c;
  assert.equal(count, 2);
});

test('reminder sweep is idempotent', async () => {
  const { request, tokens, ids, db } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner, followUpDate: dateOffset(-2) }));

  const first = await request.post('/api/follow-ups/reminders').set(auth(tokens.owner));
  const second = await request.post('/api/follow-ups/reminders').set(auth(tokens.owner));
  assert.equal(first.body.data.created, 1);
  assert.equal(second.body.data.created, 0);

  const count = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?').get(ids.owner).c;
  assert.equal(count, 1);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test('delete follow-up soft-deletes and removes it from lists', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const lead = await createLead(request, tokens.owner);
  const created = await request.post('/api/follow-ups').set(auth(tokens.owner)).send(followUpBody({ targetId: lead.id, assignedTo: ids.owner }));
  const id = created.body.data.id;

  const del = await request.delete(`/api/follow-ups/${id}`).set(auth(tokens.owner));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);

  const res = await request.get(`/api/follow-ups/${id}`).set(auth(tokens.owner));
  assert.equal(res.status, 404);
});
