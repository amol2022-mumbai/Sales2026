import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initTestApp,
  loginToken,
  createCompanyAndUser,
  createUserInCompany,
  createTeam,
  getRoleId,
} from './helpers.js';

/**
 * Build a two-team, two-company hierarchy to exercise data access:
 *
 * Company A (seed company):
 *   owner (business_owner)
 *   manager (sales_manager)  -> manages Team Alpha
 *   leader (team_leader)     -> leads Team Alpha, member of Team Alpha
 *   exec1 (sales_executive)  -> member of Team Alpha, reports to manager
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
  };

  return { request, db, ids: { owner, manager, leader, exec1, exec2, teamAlpha, teamBeta }, tokens };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

test('business owner can create a user with all Phase 2 fields', async () => {
  const { request, db, tokens, ids } = await setupHierarchy();

  const res = await request
    .post('/api/users')
    .set(auth(tokens.owner))
    .send({
      employeeId: 'E100',
      name: 'New Exec',
      email: 'new@a.test',
      password: 'NewPass123!',
      roleId: getRoleId(db, 'sales_executive'),
      teamId: ids.teamAlpha,
      managerId: ids.manager,
      phone: '+1 555 000 1111',
      territory: 'North',
      joiningDate: '2026-01-15',
    });

  assert.equal(res.status, 201);
  const u = res.body.data;
  assert.equal(u.employeeId, 'E100');
  assert.equal(u.name, 'New Exec');
  assert.equal(u.teamId, ids.teamAlpha);
  assert.equal(u.managerId, ids.manager);
  assert.equal(u.territory, 'North');
  assert.equal(u.joiningDate, '2026-01-15');
  assert.equal(u.status, 'active');
  assert.equal(u.roleKey, 'sales_executive');
});

test('duplicate email is rejected with 409', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const res = await request
    .post('/api/users')
    .set(auth(tokens.owner))
    .send({ name: 'Dup', email: 'exec1@a.test', password: 'DupPass123!', roleId: getRoleId(db, 'sales_executive') });
  assert.equal(res.status, 409);
});

test('duplicate employee id within a company is rejected', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const res = await request
    .post('/api/users')
    .set(auth(tokens.owner))
    .send({ name: 'Dup EID', email: 'dup@a.test', password: 'DupPass123!', roleId: getRoleId(db, 'sales_executive'), employeeId: 'E001' });
  assert.equal(res.status, 409);
});

test('business owner cannot assign the super admin role', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const superAdminRole = getRoleId(db, 'super_admin');
  const res = await request
    .post('/api/users')
    .set(auth(tokens.owner))
    .send({ name: 'Root', email: 'root@a.test', password: 'RootPass123!', roleId: superAdminRole });
  assert.equal(res.status, 403);
});

test('list users supports search, role filter and pagination', async () => {
  const { request, tokens } = await setupHierarchy();

  const search = await request.get('/api/users?search=exec').set(auth(tokens.owner));
  assert.equal(search.status, 200);
  assert.equal(search.body.data.length, 2);

  const byRole = await request.get('/api/users?role=sales_executive').set(auth(tokens.owner));
  assert.equal(byRole.body.data.length, 2);

  const page = await request.get('/api/users?pageSize=2&page=1').set(auth(tokens.owner));
  assert.equal(page.body.data.length, 2);
  assert.ok(page.body.meta.total >= 5);
  assert.equal(page.body.meta.page, 1);
});

test('business owner can reset a user password and the new one works', async () => {
  const { request, tokens, ids } = await setupHierarchy();

  const reset = await request
    .post(`/api/users/${ids.exec1}/reset-password`)
    .set(auth(tokens.owner))
    .send({ password: 'NewExecPass99!' });
  assert.equal(reset.status, 200);

  const loginNew = await request.post('/api/auth/login').send({ email: 'exec1@a.test', password: 'NewExecPass99!' });
  assert.equal(loginNew.status, 200);

  const loginOld = await request.post('/api/auth/login').send({ email: 'exec1@a.test', password: 'Exec1Pass123!' });
  assert.equal(loginOld.status, 401);
});

test('deactivate prevents login and reactivate restores it', async () => {
  const { request, tokens, ids } = await setupHierarchy();

  const deactivate = await request
    .post(`/api/users/${ids.exec2}/status`)
    .set(auth(tokens.owner))
    .send({ status: 'inactive' });
  assert.equal(deactivate.status, 200);
  assert.equal(deactivate.body.data.status, 'inactive');

  const blockedLogin = await request.post('/api/auth/login').send({ email: 'exec2@a.test', password: 'Exec2Pass123!' });
  assert.equal(blockedLogin.status, 401);

  const activate = await request
    .post(`/api/users/${ids.exec2}/status`)
    .set(auth(tokens.owner))
    .send({ status: 'active' });
  assert.equal(activate.status, 200);

  const okLogin = await request.post('/api/auth/login').send({ email: 'exec2@a.test', password: 'Exec2Pass123!' });
  assert.equal(okLogin.status, 200);
});

test('a user cannot deactivate themselves', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await request
    .post(`/api/users/${ids.owner}/status`)
    .set(auth(tokens.owner))
    .send({ status: 'inactive' });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Data access hierarchy
// ---------------------------------------------------------------------------

test('sales executive sees only their own record', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/users').set(auth(tokens.exec1));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].email, 'exec1@a.test');
});

test('team leader sees only their own team', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/users').set(auth(tokens.leader));
  const emails = res.body.data.map((u) => u.email).sort();
  assert.deepEqual(emails, ['exec1@a.test', 'leader@a.test']);
});

test('sales manager sees only their managed teams', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/users').set(auth(tokens.manager));
  const emails = res.body.data.map((u) => u.email).sort();
  assert.deepEqual(emails, ['exec1@a.test', 'leader@a.test', 'manager@a.test']);
});

test('business owner sees their whole company only', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/users').set(auth(tokens.owner));
  const emails = res.body.data.map((u) => u.email);
  assert.ok(emails.includes('exec2@a.test'));
  assert.ok(!emails.includes('bob@b.test'));
  assert.ok(!emails.includes('admin@test.com'));
});

test('super admin sees users across all companies', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/users').set(auth(tokens.admin));
  const emails = res.body.data.map((u) => u.email);
  assert.ok(emails.includes('exec1@a.test'));
  assert.ok(emails.includes('bob@b.test'));
});

// Record-level authorization
test('team leader cannot edit a user outside their team', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await request
    .put(`/api/users/${ids.exec2}`)
    .set(auth(tokens.leader))
    .send({ name: 'Hacked' });
  assert.equal(res.status, 403);
});

test('team leader can edit a user in their own team', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await request
    .put(`/api/users/${ids.exec1}`)
    .set(auth(tokens.leader))
    .send({ territory: 'West' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.territory, 'West');
});

test('sales manager cannot edit a user in an unassigned team', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await request
    .put(`/api/users/${ids.exec2}`)
    .set(auth(tokens.manager))
    .send({ name: 'Hacked' });
  assert.equal(res.status, 403);
});

test('business owner cannot edit a user in another company', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const bobId = db.prepare("SELECT id FROM users WHERE email = 'bob@b.test'").get().id;
  const res = await request
    .put(`/api/users/${bobId}`)
    .set(auth(tokens.owner))
    .send({ name: 'Hacked' });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

test('business owner can create a team with leader and manager', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const res = await request
    .post('/api/teams')
    .set(auth(tokens.owner))
    .send({ name: 'Team Gamma', leadId: ids.leader, managerId: ids.manager });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'Team Gamma');
  assert.equal(res.body.data.leadId, ids.leader);
  assert.equal(res.body.data.managerId, ids.manager);
});

test('team leader cannot create a team', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request
    .post('/api/teams')
    .set(auth(tokens.leader))
    .send({ name: 'Rogue Team' });
  assert.equal(res.status, 403);
});

test('business owner can move a user between teams', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const add = await request
    .post(`/api/teams/${ids.teamBeta}/members`)
    .set(auth(tokens.owner))
    .send({ userIds: [ids.exec1] });
  assert.equal(add.status, 200);
  const members = add.body.data.members.map((m) => m.id);
  assert.ok(members.includes(ids.exec1));

  const remove = await request
    .delete(`/api/teams/${ids.teamBeta}/members/${ids.exec1}`)
    .set(auth(tokens.owner));
  assert.equal(remove.status, 200);
  assert.ok(!remove.body.data.members.map((m) => m.id).includes(ids.exec1));
});

test('sales manager can add members to their managed team but not an unassigned team', async () => {
  const { request, tokens, ids } = await setupHierarchy();

  const allowed = await request
    .post(`/api/teams/${ids.teamAlpha}/members`)
    .set(auth(tokens.manager))
    .send({ userIds: [ids.exec2] });
  assert.equal(allowed.status, 200);

  const denied = await request
    .post(`/api/teams/${ids.teamBeta}/members`)
    .set(auth(tokens.manager))
    .send({ userIds: [ids.exec1] });
  assert.equal(denied.status, 403);
});

test('team leader can view but not modify their team', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const view = await request.get(`/api/teams/${ids.teamAlpha}`).set(auth(tokens.leader));
  assert.equal(view.status, 200);
  assert.equal(view.body.data.name, 'Team Alpha');

  const edit = await request
    .put(`/api/teams/${ids.teamAlpha}`)
    .set(auth(tokens.leader))
    .send({ name: 'Renamed' });
  assert.equal(edit.status, 403);
});

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

test('super admin can view the permission catalog grouped by module', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/roles/permissions').set(auth(tokens.admin));
  assert.equal(res.status, 200);
  const modules = res.body.data.modules.map((m) => m.module);
  assert.ok(modules.includes('users'));
  assert.ok(modules.includes('sales_team'));
  assert.ok(modules.includes('leads'));
});

test('permission catalog includes approve and assign actions', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/roles/permissions').set(auth(tokens.admin));
  const actions = res.body.data.actions;
  assert.ok(actions.includes('approve'));
  assert.ok(actions.includes('assign'));
});

test('super admin can update a role permission set', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const viewerRoleId = getRoleId(db, 'viewer');

  const update = await request
    .put(`/api/roles/${viewerRoleId}/permissions`)
    .set(auth(tokens.admin))
    .send({ permissionKeys: ['dashboard:view', 'users:view'] });
  assert.equal(update.status, 200);
  const keys = update.body.data.permissions.map((p) => p.key).sort();
  assert.deepEqual(keys, ['dashboard:view', 'users:view']);
});

test('business owner cannot update role permissions', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const viewerRoleId = getRoleId(db, 'viewer');
  const res = await request
    .put(`/api/roles/${viewerRoleId}/permissions`)
    .set(auth(tokens.owner))
    .send({ permissionKeys: ['dashboard:view'] });
  assert.equal(res.status, 403);
});

test('the super admin role itself cannot be edited', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const saId = getRoleId(db, 'super_admin');
  const res = await request
    .put(`/api/roles/${saId}/permissions`)
    .set(auth(tokens.admin))
    .send({ permissionKeys: [] });
  assert.equal(res.status, 400);
});

test('updating a role with unknown permission keys is rejected', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const viewerRoleId = getRoleId(db, 'viewer');
  const res = await request
    .put(`/api/roles/${viewerRoleId}/permissions`)
    .set(auth(tokens.admin))
    .send({ permissionKeys: ['dashboard:view', 'nonsense:fly'] });
  assert.equal(res.status, 400);
});
