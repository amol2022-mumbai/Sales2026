import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  initTestApp,
  loginToken,
  createCompanyAndUser,
  createUserInCompany,
  createTeam,
} from './helpers.js';

/**
 * Reuse the Phase 2 hierarchy to exercise lead data access:
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
  };

  return { request, db, ids: { owner, manager, leader, exec1, exec2, teamAlpha, teamBeta }, tokens };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const leadBody = (overrides = {}) => ({
  companyName: 'Acme Corp',
  contactPerson: 'Jane Doe',
  mobile: '+1 555 111 2222',
  email: 'jane@acme.test',
  city: 'Austin',
  source: 'Website',
  leadValue: 5000,
  priority: 'High',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Create / read / update / delete
// ---------------------------------------------------------------------------

test('business owner can create a lead with full fields and get a lead number', async () => {
  const { request, tokens, ids } = await setupHierarchy();

  const res = await request.post('/api/leads').set(auth(tokens.owner)).send(
    leadBody({
      whatsapp: '+1 555 111 2222',
      address: '1 Main St',
      state: 'TX',
      productService: 'Consulting',
      status: 'Interested',
      nextFollowUp: '2026-03-01',
      notes: 'Initial contact',
      remarks: 'Hot lead',
    })
  );

  assert.equal(res.status, 201);
  const lead = res.body.data;
  assert.ok(/^LEAD-\d{6}$/.test(lead.leadNo));
  assert.equal(lead.companyName, 'Acme Corp');
  assert.equal(lead.contactPerson, 'Jane Doe');
  assert.equal(lead.leadValue, 5000);
  assert.equal(lead.priority, 'High');
  assert.equal(lead.status, 'Interested');
  assert.equal(lead.assignedTo, ids.owner);
  assert.equal(lead.assignedName, 'Owner');
  assert.equal(lead.nextFollowUp, '2026-03-01');
});

test('lead defaults priority to Medium and status to New', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.post('/api/leads').set(auth(tokens.owner)).send({ companyName: 'Minimal Co' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.priority, 'Medium');
  assert.equal(res.body.data.status, 'New');
});

test('lead creation is rejected without a company name', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.post('/api/leads').set(auth(tokens.owner)).send({ email: 'x@y.test' });
  assert.equal(res.status, 400);
});

test('get lead returns activities and follow-up history', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody());
  const id = created.body.data.id;

  const updated = await request
    .put(`/api/leads/${id}`)
    .set(auth(tokens.owner))
    .send({ status: 'Qualified', nextFollowUp: '2026-04-01' });
  assert.equal(updated.status, 200);

  const note = await request.post(`/api/leads/${id}/notes`).set(auth(tokens.owner)).send({ note: 'Called customer' });
  assert.equal(note.status, 200);
  assert.equal(note.body.data.type, 'note');
  assert.equal(note.body.data.description, 'Called customer');

  const res = await request.get(`/api/leads/${id}`).set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const types = res.body.data.activities.map((a) => a.type);
  assert.ok(types.includes('created'));
  assert.ok(types.includes('status'));
  assert.ok(types.includes('follow_up'));
  assert.ok(types.includes('note'));
  assert.ok(res.body.data.followUpHistory.some((a) => a.type === 'follow_up'));
});

test('list leads supports search, status filter and pagination', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Alpha Corp', status: 'New' }));
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Beta Corp', status: 'Won' }));

  const search = await request.get('/api/leads?search=alpha').set(auth(tokens.owner));
  assert.equal(search.status, 200);
  assert.equal(search.body.data.length, 1);
  assert.equal(search.body.data[0].companyName, 'Alpha Corp');

  const byStatus = await request.get('/api/leads?status=Won').set(auth(tokens.owner));
  assert.equal(byStatus.body.data.length, 1);

  const page = await request.get('/api/leads?pageSize=1&page=1').set(auth(tokens.owner));
  assert.equal(page.body.data.length, 1);
  assert.ok(page.body.meta.total >= 2);
});

test('delete lead is a soft delete and hides it from list/get', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody());
  const id = created.body.data.id;

  const del = await request.delete(`/api/leads/${id}`).set(auth(tokens.owner));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);

  const gone = await request.get(`/api/leads/${id}`).set(auth(tokens.owner));
  assert.equal(gone.status, 404);

  const list = await request.get('/api/leads?search=Acme').set(auth(tokens.owner));
  assert.equal(list.body.data.length, 0);
});

// ---------------------------------------------------------------------------
// Bulk operations & dashboard
// ---------------------------------------------------------------------------

test('bulk assign and bulk status update leads within scope', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const l1 = await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'One' }));
  const l2 = await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Two' }));
  const id1 = l1.body.data.id;
  const id2 = l2.body.data.id;

  const assign = await request
    .post('/api/leads/bulk-assign')
    .set(auth(tokens.owner))
    .send({ leadIds: [id1, id2], assignedTo: ids.exec1 });
  assert.equal(assign.status, 200);
  assert.equal(assign.body.data.updated, 2);

  const status = await request
    .post('/api/leads/bulk-status')
    .set(auth(tokens.owner))
    .send({ leadIds: [id1, id2], status: 'Qualified' });
  assert.equal(status.status, 200);
  assert.equal(status.body.data.updated, 2);

  const check = await request.get(`/api/leads/${id1}`).set(auth(tokens.owner));
  assert.equal(check.body.data.assignedTo, ids.exec1);
  assert.equal(check.body.data.status, 'Qualified');
});

test('lead dashboard returns KPIs and byStatus counts', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Won Co', status: 'Won' }));
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Lost Co', status: 'Lost' }));
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'New Co' }));

  const res = await request.get('/api/leads/dashboard').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.total, 3);
  assert.equal(d.won, 1);
  assert.equal(d.lost, 1);
  assert.equal(d.newLeads, 1);
  assert.ok(d.byStatus.find((s) => s.status === 'Won').count === 1);
  assert.ok(typeof d.conversionRate === 'number');
});

test('lead meta returns statuses, priorities and sources', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/leads/meta').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.statuses.includes('Proposal Sent'));
  assert.ok(res.body.data.priorities.includes('High'));
  assert.ok(res.body.data.sources.includes('Website'));
});

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

const CSV_HEADER = 'Company,Contact Person,Email,Mobile,Lead Value,Priority,Status,Next Follow-up,Source\n';

test('import CSV creates leads and reports duplicates', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const csv =
    CSV_HEADER +
    'Imported Co,Alice,alice@x.test,111,1000,High,New,2026-05-01,Website\n' +
    'Imported Co,Alice,alice@x.test,111,2000,Medium,New,2026-05-01,Website\n';

  const res = await request.post('/api/leads/import').set(auth(tokens.owner)).send({ format: 'csv', data: csv });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.total, 2);
  assert.equal(res.body.data.imported, 1);
  assert.equal(res.body.data.duplicates.length, 1);
  assert.equal(res.body.data.errors.length, 0);
});

test('import CSV rejects rows with invalid data and reports errors', async () => {
  const { request, tokens } = await setupHierarchy();
  const csv =
    CSV_HEADER +
    'Bad Co,Bob,not-an-email,111,1000,Low,New,2026-06-01,Cold Call\n' +
    'Good Co,Alice,alice@x.test,222,3000,Low,New,2026-06-01,Cold Call\n';

  const res = await request.post('/api/leads/import').set(auth(tokens.owner)).send({ format: 'csv', data: csv });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.imported, 1);
  assert.equal(res.body.data.errors.length, 1);
});

test('import detects duplicates against existing leads', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Existing Co', email: 'dup@x.test' }));

  const csv = CSV_HEADER + 'Existing Co,Someone,dup@x.test,333,1000,Low,New,2026-06-01,Referral\n';
  const res = await request.post('/api/leads/import').set(auth(tokens.owner)).send({ format: 'csv', data: csv });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.imported, 0);
  assert.equal(res.body.data.duplicates.length, 1);
});

test('import XLSX creates leads', async () => {
  const { request, tokens } = await setupHierarchy();
  const aoa = [
    ['Company', 'Contact Person', 'Email', 'Lead Value', 'Priority'],
    ['Excel Lead', 'Carol', 'carol@x.test', 7500, 'High'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const res = await request
    .post('/api/leads/import')
    .set(auth(tokens.owner))
    .send({ format: 'xlsx', data: buffer.toString('base64') });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.imported, 1);
  assert.equal(res.body.data.errors.length, 0);
});

test('export leads returns CSV scoped to the caller', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Export Co' }));

  const res = await request.get('/api/leads/export?format=csv').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text, /Lead ID/);
  assert.match(res.text, /Export Co/);
});

test('export leads returns XLSX', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Excel Co' }));

  const res = await request.get('/api/leads/export?format=xlsx').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /spreadsheetml/);
  assert.ok((res.text?.length ?? 0) > 0);
});

// ---------------------------------------------------------------------------
// Data access hierarchy
// ---------------------------------------------------------------------------

test('sales executive sees only leads assigned to them', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Mine', assignedTo: ids.exec1 }));
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Not Mine', assignedTo: ids.exec2 }));

  const res = await request.get('/api/leads').set(auth(tokens.exec1));
  assert.equal(res.status, 200);
  const names = res.body.data.map((l) => l.companyName);
  assert.ok(names.includes('Mine'));
  assert.ok(!names.includes('Not Mine'));
});

test('team leader sees leads in their team or assigned to themselves', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'In Team', teamId: ids.teamAlpha }));
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Other Team', teamId: ids.teamBeta }));

  const res = await request.get('/api/leads').set(auth(tokens.leader));
  const names = res.body.data.map((l) => l.companyName);
  assert.ok(names.includes('In Team'));
  assert.ok(!names.includes('Other Team'));
});

test('business owner sees leads across their company only', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const companyB = db.prepare("SELECT company_id AS id FROM users WHERE email = 'bob@b.test'").get().id;

  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Company A Lead' }));
  await request.post('/api/leads').set(auth(tokens.admin)).send(leadBody({ companyName: 'Company B Lead', companyId: companyB }));

  const res = await request.get('/api/leads').set(auth(tokens.owner));
  const names = res.body.data.map((l) => l.companyName);
  assert.ok(names.includes('Company A Lead'));
  assert.ok(!names.includes('Company B Lead'));
});

test('sales executive cannot access another company lead', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const created = await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Restricted', assignedTo: ids.exec2 }));
  const id = created.body.data.id;

  const res = await request.get(`/api/leads/${id}`).set(auth(tokens.exec1));
  assert.equal(res.status, 403);
});

test('sales executive cannot edit a lead they do not own', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const created = await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Other', assignedTo: ids.exec2 }));
  const id = created.body.data.id;

  const res = await request.put(`/api/leads/${id}`).set(auth(tokens.exec1)).send({ status: 'Won' });
  assert.equal(res.status, 403);
});

test('viewer cannot create a lead', async () => {
  const { request, db, seed } = initTestApp();
  const a = seed.companyId;
  const viewerId = createUserInCompany(db, a, { name: 'Viewer', email: 'viewer@a.test', password: 'ViewerPass123!', roleKey: 'viewer' });
  const viewer = await loginToken(request, 'viewer@a.test', 'ViewerPass123!');

  const res = await request.post('/api/leads').set(auth(viewer)).send(leadBody());
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Global search integration
// ---------------------------------------------------------------------------

test('global search returns leads for the calling user', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'Searchable Co' }));

  const res = await request.get('/api/search?q=Searchable').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.results.leads.length >= 1);
  assert.equal(res.body.data.results.leads[0].company_name, 'Searchable Co');
});

test('global search scoped to leads returns only leads', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/leads').set(auth(tokens.owner)).send(leadBody({ companyName: 'OnlyLead Co' }));

  const res = await request.get('/api/search?q=OnlyLead&scope=leads').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.results.leads.length >= 1);
  assert.deepEqual(res.body.data.results.users, []);
});
