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
 * Reuse the Phase 2 hierarchy to exercise customer data access:
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

const customerBody = (overrides = {}) => ({
  name: 'Acme Industries',
  contactPerson: 'Jane Doe',
  email: 'jane@acmeindustries.test',
  mobile: '+1 555 222 3333',
  city: 'Houston',
  state: 'TX',
  gst: 'GSTIN1234567',
  pan: 'ABCDE1234F',
  customerType: 'Company',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Create / read / update / delete
// ---------------------------------------------------------------------------

test('business owner can create a customer with full fields and get a number', async () => {
  const { request, tokens, ids } = await setupHierarchy();

  const res = await request.post('/api/customers').set(auth(tokens.owner)).send(
    customerBody({ whatsapp: '+1 555 222 3333', address: '5 Main St', status: 'Active' })
  );

  assert.equal(res.status, 201);
  const c = res.body.data;
  assert.ok(/^CUST-\d{6}$/.test(c.customerNo));
  assert.equal(c.name, 'Acme Industries');
  assert.equal(c.contactPerson, 'Jane Doe');
  assert.equal(c.gst, 'GSTIN1234567');
  assert.equal(c.pan, 'ABCDE1234F');
  assert.equal(c.customerType, 'Company');
  assert.equal(c.status, 'Active');
  assert.equal(c.assignedTo, ids.owner);
});

test('customer defaults type to Company and status to Active', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.post('/api/customers').set(auth(tokens.owner)).send({ name: 'Solo Trader' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.customerType, 'Company');
  assert.equal(res.body.data.status, 'Active');
});

test('customer creation is rejected without a name', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.post('/api/customers').set(auth(tokens.owner)).send({ email: 'x@y.test' });
  assert.equal(res.status, 400);
});

test('duplicate customer (name + email) is rejected with 409', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody());
  const res = await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ contactPerson: 'Other' }));
  assert.equal(res.status, 409);
});

test('get customer returns activities, KPIs, lead history and empty buckets', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody());
  const id = created.body.data.id;

  const note = await request.post(`/api/customers/${id}/notes`).set(auth(tokens.owner)).send({ note: 'Called customer' });
  assert.equal(note.status, 200);
  assert.equal(note.body.data.type, 'note');

  const res = await request.get(`/api/customers/${id}`).set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const c = res.body.data;
  assert.ok(c.activities.some((a) => a.type === 'created'));
  assert.ok(c.activities.some((a) => a.type === 'note'));
  assert.deepEqual(c.quotations, []);
  assert.deepEqual(c.orders, []);
  assert.deepEqual(c.sales, []);
  assert.deepEqual(c.payments, []);
  assert.equal(c.kpis.totalSales, 0);
  assert.equal(c.kpis.orderCount, 0);
  assert.equal(c.kpis.status, 'Active');
});

test('record call, meeting, follow-up and complaint activities', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody());
  const id = created.body.data.id;

  await request.post(`/api/customers/${id}/activities`).set(auth(tokens.owner)).send({ type: 'call', description: 'Called about renewal' });
  await request.post(`/api/customers/${id}/activities`).set(auth(tokens.owner)).send({ type: 'meeting', description: 'Site visit' });
  await request.post(`/api/customers/${id}/activities`).set(auth(tokens.owner)).send({ type: 'follow_up', description: 'Follow-up next week', scheduledAt: '2026-06-15' });
  await request.post(`/api/customers/${id}/activities`).set(auth(tokens.owner)).send({ type: 'complaint', description: 'Late delivery' });

  const res = await request.get(`/api/customers/${id}`).set(auth(tokens.owner));
  assert.equal(res.body.data.calls.length, 1);
  assert.equal(res.body.data.meetings.length, 1);
  assert.equal(res.body.data.followUps.length, 1);
  assert.equal(res.body.data.complaints.length, 1);
  assert.equal(res.body.data.followUps[0].metadata.scheduledAt, '2026-06-15');
});

test('list customers supports search, filter and pagination', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Alpha Inc', status: 'Active' }));
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Beta Inc', email: 'b@beta.test', status: 'Blocked' }));

  const search = await request.get('/api/customers?search=alpha').set(auth(tokens.owner));
  assert.equal(search.body.data.length, 1);
  assert.equal(search.body.data[0].name, 'Alpha Inc');

  const byStatus = await request.get('/api/customers?status=Blocked').set(auth(tokens.owner));
  assert.equal(byStatus.body.data.length, 1);

  const page = await request.get('/api/customers?pageSize=1&page=1').set(auth(tokens.owner));
  assert.equal(page.body.data.length, 1);
  assert.ok(page.body.meta.total >= 2);
});

test('delete customer is a soft delete and hides it from list/get', async () => {
  const { request, tokens } = await setupHierarchy();
  const created = await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody());
  const id = created.body.data.id;

  const del = await request.delete(`/api/customers/${id}`).set(auth(tokens.owner));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);

  const gone = await request.get(`/api/customers/${id}`).set(auth(tokens.owner));
  assert.equal(gone.status, 404);

  const list = await request.get('/api/customers?search=Acme').set(auth(tokens.owner));
  assert.equal(list.body.data.length, 0);
});

// ---------------------------------------------------------------------------
// Bulk operations & dashboard
// ---------------------------------------------------------------------------

test('bulk assign and bulk status update customers within scope', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const c1 = await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'One' }));
  const c2 = await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Two', email: 'two@x.test' }));
  const id1 = c1.body.data.id;
  const id2 = c2.body.data.id;

  const assign = await request
    .post('/api/customers/bulk-assign')
    .set(auth(tokens.owner))
    .send({ customerIds: [id1, id2], assignedTo: ids.exec1 });
  assert.equal(assign.status, 200);
  assert.equal(assign.body.data.updated, 2);

  const status = await request
    .post('/api/customers/bulk-status')
    .set(auth(tokens.owner))
    .send({ customerIds: [id1, id2], status: 'Inactive' });
  assert.equal(status.body.data.updated, 2);

  const check = await request.get(`/api/customers/${id1}`).set(auth(tokens.owner));
  assert.equal(check.body.data.assignedTo, ids.exec1);
  assert.equal(check.body.data.status, 'Inactive');
});

test('customer dashboard returns KPIs and byType counts', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Active Co', status: 'Active' }));
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Blocked Co', email: 'bl@x.test', status: 'Blocked' }));

  const res = await request.get('/api/customers/dashboard').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.total, 2);
  assert.equal(d.active, 1);
  assert.equal(d.blocked, 1);
  assert.ok(d.byType.some((t) => t.type === 'Company' && t.count === 2));
});

test('customer meta returns types and statuses', async () => {
  const { request, tokens } = await setupHierarchy();
  const res = await request.get('/api/customers/meta').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.types.includes('Distributor'));
  assert.ok(res.body.data.statuses.includes('Blocked'));
});

// ---------------------------------------------------------------------------
// Lead conversion
// ---------------------------------------------------------------------------

test('qualified lead converts to a customer preserving lead history', async () => {
  const { request, tokens } = await setupHierarchy();

  const leadRes = await request
    .post('/api/leads')
    .set(auth(tokens.owner))
    .send({
      companyName: 'Convert Me Ltd',
      contactPerson: 'Alice',
      email: 'alice@convert.test',
      mobile: '+1 555 999 0000',
      city: 'Dallas',
      status: 'Qualified',
      priority: 'High',
    });
  const leadId = leadRes.body.data.id;
  const leadNo = leadRes.body.data.leadNo;

  const res = await request.post('/api/customers/convert').set(auth(tokens.owner)).send({ leadId });
  assert.equal(res.status, 201);
  const c = res.body.data;
  assert.equal(c.name, 'Convert Me Ltd');
  assert.equal(c.email, 'alice@convert.test');
  assert.equal(c.leadId, leadId);
  assert.equal(c.leadNo, leadNo);

  const lead = await request.get(`/api/leads/${leadId}`).set(auth(tokens.owner));
  assert.equal(lead.body.data.status, 'Won');

  const profile = await request.get(`/api/customers/${c.id}`).set(auth(tokens.owner));
  assert.ok(profile.body.data.leadHistory);
  assert.equal(profile.body.data.leadHistory.lead_no, leadNo);
  assert.ok(profile.body.data.leadHistory.activities.some((a) => a.type === 'created'));
  assert.ok(profile.body.data.activities.some((a) => a.type === 'converted'));
});

test('converting the same lead twice is rejected', async () => {
  const { request, tokens } = await setupHierarchy();
  const leadRes = await request
    .post('/api/leads')
    .set(auth(tokens.owner))
    .send({ companyName: 'Twice Ltd', status: 'Won' });
  const leadId = leadRes.body.data.id;

  const first = await request.post('/api/customers/convert').set(auth(tokens.owner)).send({ leadId });
  assert.equal(first.status, 201);

  const second = await request.post('/api/customers/convert').set(auth(tokens.owner)).send({ leadId });
  assert.equal(second.status, 409);
});

test('non-qualified/non-won lead cannot be converted', async () => {
  const { request, tokens } = await setupHierarchy();
  const leadRes = await request
    .post('/api/leads')
    .set(auth(tokens.owner))
    .send({ companyName: 'Not Ready Ltd', status: 'New' });
  const res = await request.post('/api/customers/convert').set(auth(tokens.owner)).send({ leadId: leadRes.body.data.id });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

const CSV_HEADER = 'Company/Name,Contact Person,Email,Mobile,GST,Customer Type,Status\n';

test('import CSV creates customers and reports duplicates', async () => {
  const { request, tokens } = await setupHierarchy();
  const csv =
    CSV_HEADER +
    'Imported Ltd,Alice,alice@x.test,111,GST1,Company,Active\n' +
    'Imported Ltd,Alice,alice@x.test,111,GST1,Company,Active\n';

  const res = await request.post('/api/customers/import').set(auth(tokens.owner)).send({ format: 'csv', data: csv });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.total, 2);
  assert.equal(res.body.data.imported, 1);
  assert.equal(res.body.data.duplicates.length, 1);
});

test('import CSV rejects invalid rows and reports errors', async () => {
  const { request, tokens } = await setupHierarchy();
  const csv =
    CSV_HEADER +
    'Bad Ltd,Bob,not-an-email,111,GST1,Company,Active\n' +
    'Good Ltd,Carol,carol@x.test,222,GST2,Distributor,Active\n';

  const res = await request.post('/api/customers/import').set(auth(tokens.owner)).send({ format: 'csv', data: csv });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.imported, 1);
  assert.equal(res.body.data.errors.length, 1);
});

test('import detects duplicates against existing customers', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Existing Ltd', email: 'dup@x.test' }));

  const csv = CSV_HEADER + 'Existing Ltd,Someone,dup@x.test,333,GST9,Company,Active\n';
  const res = await request.post('/api/customers/import').set(auth(tokens.owner)).send({ format: 'csv', data: csv });
  assert.equal(res.body.data.imported, 0);
  assert.equal(res.body.data.duplicates.length, 1);
});

test('import XLSX creates customers', async () => {
  const { request, tokens } = await setupHierarchy();
  const aoa = [
    ['Company/Name', 'Contact Person', 'Email', 'Customer Type'],
    ['Excel Ltd', 'Dave', 'dave@x.test', 'Company'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const res = await request
    .post('/api/customers/import')
    .set(auth(tokens.owner))
    .send({ format: 'xlsx', data: buffer.toString('base64') });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.imported, 1);
});

test('export customers returns CSV scoped to the caller', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Export Co' }));

  const res = await request.get('/api/customers/export?format=csv').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text, /Customer ID/);
  assert.match(res.text, /Export Co/);
});

test('export customers returns XLSX', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Excel Co' }));

  const res = await request.get('/api/customers/export?format=xlsx').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /spreadsheetml/);
  assert.ok((res.text?.length ?? 0) > 0);
});

// ---------------------------------------------------------------------------
// Data access hierarchy
// ---------------------------------------------------------------------------

test('sales executive sees only customers assigned to them', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Mine', assignedTo: ids.exec1 }));
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Not Mine', email: 'nm@x.test', assignedTo: ids.exec2 }));

  const res = await request.get('/api/customers').set(auth(tokens.exec1));
  const names = res.body.data.map((c) => c.name);
  assert.ok(names.includes('Mine'));
  assert.ok(!names.includes('Not Mine'));
});

test('business owner sees customers across their company only', async () => {
  const { request, tokens, db } = await setupHierarchy();
  const companyB = db.prepare("SELECT company_id AS id FROM users WHERE email = 'bob@b.test'").get().id;

  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Company A Customer' }));
  await request.post('/api/customers').set(auth(tokens.admin)).send(customerBody({ name: 'Company B Customer', companyId: companyB }));

  const res = await request.get('/api/customers').set(auth(tokens.owner));
  const names = res.body.data.map((c) => c.name);
  assert.ok(names.includes('Company A Customer'));
  assert.ok(!names.includes('Company B Customer'));
});

test('sales executive cannot access another salesperson customer', async () => {
  const { request, tokens, ids } = await setupHierarchy();
  const created = await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Restricted', assignedTo: ids.exec2 }));
  const res = await request.get(`/api/customers/${created.body.data.id}`).set(auth(tokens.exec1));
  assert.equal(res.status, 403);
});

test('viewer cannot create a customer', async () => {
  const { request, db, seed } = initTestApp();
  const a = seed.companyId;
  createUserInCompany(db, a, { name: 'Viewer', email: 'viewer@a.test', password: 'ViewerPass123!', roleKey: 'viewer' });
  const viewer = await loginToken(request, 'viewer@a.test', 'ViewerPass123!');

  const res = await request.post('/api/customers').set(auth(viewer)).send(customerBody());
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Global search integration
// ---------------------------------------------------------------------------

test('global search returns customers for the calling user', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'Searchable Co' }));

  const res = await request.get('/api/search?q=Searchable').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.results.customers.length >= 1);
  assert.equal(res.body.data.results.customers[0].name, 'Searchable Co');
});

test('global search scoped to customers returns only customers', async () => {
  const { request, tokens } = await setupHierarchy();
  await request.post('/api/customers').set(auth(tokens.owner)).send(customerBody({ name: 'OnlyCust Co' }));

  const res = await request.get('/api/search?q=OnlyCust&scope=customers').set(auth(tokens.owner));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.results.customers.length >= 1);
  assert.deepEqual(res.body.data.results.leads, []);
});
