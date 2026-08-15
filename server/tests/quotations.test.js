import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser, addUserToCompany } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function insertLicense(db, companyId, { modules = null, status = 'active' } = {}) {
  return Number(
    db
      .prepare(
        `INSERT INTO licenses (company_id, plan_id, status, modules) VALUES (?, NULL, ?, ?)`
      )
      .run(companyId, status, modules == null ? null : JSON.stringify(modules)).lastInsertRowid
  );
}

function insertCustomer(db, companyId, name = 'Acme Corp') {
  return Number(
    db
      .prepare("INSERT INTO customers (company_id, name, customer_type, status) VALUES (?, ?, 'Company', 'Active')")
      .run(companyId, name).lastInsertRowid
  );
}

function insertProduct(db, companyId, { name = 'Widget', unitPrice = 10, taxRate = 5, unit = 'pcs' } = {}) {
  return Number(
    db
      .prepare("INSERT INTO products (company_id, name, unit_price, tax_rate, unit, status) VALUES (?, ?, ?, ?, ?, 'Active')")
      .run(companyId, name, unitPrice, taxRate, unit).lastInsertRowid
  );
}

test('business_owner can create, list, read, update and delete quotations with line items', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'Owner Q Co',
    email: 'qowner@p.test',
    password: 'OwnerQPass1!',
    roleKey: 'business_owner',
  });
  const token = await loginToken(request, 'qowner@p.test', 'OwnerQPass1!');
  const customerId = insertCustomer(db, companyId);

  const created = await request.post('/api/quotations').set(auth(token)).send({
    customerId,
    status: 'Draft',
    discount: 1,
    items: [
      { name: 'Consulting', quantity: 2, unitPrice: 100, taxRate: 10 },
      { name: 'License', quantity: 1, unitPrice: 50, taxRate: 0 },
    ],
  });
  assert.equal(created.status, 201);
  const q = created.body.data;
  assert.ok(q.id);
  assert.match(q.quotationNo, /^QTN-\d{6}$/);
  assert.equal(q.companyId, companyId);
  assert.equal(q.customerId, customerId);
  assert.equal(q.customerName, 'Acme Corp');
  // Consulting: 2*100=200 tax 20; License: 1*50=50 tax 0
  assert.equal(q.subtotal, 250);
  assert.equal(q.taxAmount, 20);
  assert.equal(q.total, 269); // 250 + 20 - 1
  assert.equal(q.items.length, 2);
  assert.equal(q.status, 'Draft');

  const list = await request.get('/api/quotations').set(auth(token));
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.total, 1);
  assert.equal(list.body.data[0].quotationNo, q.quotationNo);

  const got = await request.get(`/api/quotations/${q.id}`).set(auth(token));
  assert.equal(got.status, 200);
  assert.equal(got.body.data.customerName, 'Acme Corp');
  assert.equal(got.body.data.items.length, 2);

  const updated = await request.put(`/api/quotations/${q.id}`).set(auth(token)).send({ status: 'Sent', discount: 20 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.status, 'Sent');
  assert.equal(updated.body.data.total, 250); // 250 + 20 - 20

  const del = await request.delete(`/api/quotations/${q.id}`).set(auth(token));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);

  assert.equal((await request.get(`/api/quotations/${q.id}`).set(auth(token))).status, 404);
});

test('quotations are isolated between tenants', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Tenant QA', email: 'qa@p.test', password: 'TenantQA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Tenant QB', email: 'qb@p.test', password: 'TenantQB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'qa@p.test', 'TenantQA123!');
  const tokenB = await loginToken(request, 'qb@p.test', 'TenantQB123!');
  const customerIdA = insertCustomer(db, a.companyId);

  const created = await request
    .post('/api/quotations')
    .set(auth(tokenA))
    .send({ customerId: customerIdA, items: [{ name: 'Secret Quote', quantity: 1, unitPrice: 10 }] });
  assert.equal(created.status, 201);
  const id = created.body.data.id;

  assert.equal((await request.get('/api/quotations').set(auth(tokenB))).body.meta.total, 0, 'tenant B list is empty');
  assert.equal((await request.get(`/api/quotations/${id}`).set(auth(tokenB))).status, 403);
  assert.equal((await request.put(`/api/quotations/${id}`).set(auth(tokenB)).send({ status: 'Sent' })).status, 403);
  assert.equal((await request.delete(`/api/quotations/${id}`).set(auth(tokenB))).status, 403);
});

test('client-supplied companyId is ignored for non-super-admin users', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Spoof QA', email: 'qsa@p.test', password: 'SpoofQA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Spoof QB', email: 'qsb@p.test', password: 'SpoofQB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'qsa@p.test', 'SpoofQA123!');
  const customerIdA = insertCustomer(db, a.companyId);

  const created = await request
    .post('/api/quotations')
    .set(auth(tokenA))
    .send({ customerId: customerIdA, companyId: b.companyId, items: [{ name: 'Owned', quantity: 1, unitPrice: 10 }] });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.companyId, a.companyId, 'quotation is always created under the authenticated company');
});

test('view-only roles cannot create, edit or delete quotations', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'View Q Co', email: 'qview@p.test', password: 'ViewQ123!', roleKey: 'business_owner' });
  addUserToCompany(db, a.companyId, { name: 'Read Only', email: 'qreader@p.test', password: 'ReaderQ123!', roleKey: 'viewer' });

  const ownerToken = await loginToken(request, 'qview@p.test', 'ViewQ123!');
  const readerToken = await loginToken(request, 'qreader@p.test', 'ReaderQ123!');
  const customerId = insertCustomer(db, a.companyId);

  const created = await request
    .post('/api/quotations')
    .set(auth(ownerToken))
    .send({ customerId, items: [{ name: 'Catalog', quantity: 1, unitPrice: 10 }] });
  const id = created.body.data.id;

  assert.equal((await request.get('/api/quotations').set(auth(readerToken))).status, 200);
  assert.equal((await request.get(`/api/quotations/${id}`).set(auth(readerToken))).status, 200);
  assert.equal((await request.post('/api/quotations').set(auth(readerToken)).send({ customerId, items: [{ name: 'X', quantity: 1, unitPrice: 10 }] })).status, 403);
  assert.equal((await request.put(`/api/quotations/${id}`).set(auth(readerToken)).send({ status: 'Sent' })).status, 403);
  assert.equal((await request.delete(`/api/quotations/${id}`).set(auth(readerToken))).status, 403);
});

test('quotation validation rejects missing customer, empty items and invalid values', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Val Q Co', email: 'qval@p.test', password: 'ValQ123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'qval@p.test', 'ValQ123!');
  const customerId = insertCustomer(db, companyId);

  assert.equal((await request.post('/api/quotations').set(auth(token)).send({ items: [{ name: 'X', quantity: 1, unitPrice: 10 }] })).status, 400);
  assert.equal((await request.post('/api/quotations').set(auth(token)).send({ customerId, items: [] })).status, 400);
  assert.equal((await request.post('/api/quotations').set(auth(token)).send({ customerId, items: [{ name: 'X', quantity: 1, unitPrice: 10, taxRate: 150 }] })).status, 400);
  assert.equal((await request.post('/api/quotations').set(auth(token)).send({ customerId, items: [{ name: 'X', quantity: -1, unitPrice: 10 }] })).status, 400);
  assert.equal((await request.post('/api/quotations').set(auth(token)).send({ customerId: 999999, items: [{ name: 'X', quantity: 1, unitPrice: 10 }] })).status, 404);
});

test('module gating blocks quotations for tenants without the module', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Gated Q Co', email: 'qgated@p.test', password: 'GatedQ123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { modules: ['leads'] });

  const token = await loginToken(request, 'qgated@p.test', 'GatedQ123!');
  const res = await request.get('/api/quotations').set(auth(token));
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'MODULE_DISABLED');
});

test('quotation create/update/delete writes audit log entries', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Audit Q Co', email: 'qaud@p.test', password: 'AuditQ123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'qaud@p.test', 'AuditQ123!');
  const customerId = insertCustomer(db, companyId);

  const created = await request.post('/api/quotations').set(auth(token)).send({ customerId, items: [{ name: 'Tracked', quantity: 1, unitPrice: 10 }] });
  const id = created.body.data.id;
  await request.put(`/api/quotations/${id}`).set(auth(token)).send({ status: 'Sent' });
  await request.delete(`/api/quotations/${id}`).set(auth(token));

  const creates = db.prepare("SELECT * FROM audit_logs WHERE action = 'quotation.create' AND company_id = ?").all(companyId);
  const updates = db.prepare("SELECT * FROM audit_logs WHERE action = 'quotation.update' AND company_id = ?").all(companyId);
  const deletes = db.prepare("SELECT * FROM audit_logs WHERE action = 'quotation.delete' AND company_id = ?").all(companyId);

  assert.equal(creates.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(deletes.length, 1);
});

test('line items snapshot product fields and reject foreign products', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Prod QA', email: 'qpa@p.test', password: 'ProdQA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Prod QB', email: 'qpb@p.test', password: 'ProdQB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'qpa@p.test', 'ProdQA123!');
  const customerIdA = insertCustomer(db, a.companyId);

  const productA = insertProduct(db, a.companyId, { name: 'Widget A', unitPrice: 25, taxRate: 7, unit: 'pcs' });
  const productB = insertProduct(db, b.companyId, { name: 'Widget B' });

  const created = await request
    .post('/api/quotations')
    .set(auth(tokenA))
    .send({ customerId: customerIdA, items: [{ productId: productA, name: 'ignored', quantity: 2 }] });
  assert.equal(created.status, 201);
  const item = created.body.data.items[0];
  assert.equal(item.name, 'Widget A');
  assert.equal(item.unitPrice, 25);
  assert.equal(item.taxRate, 7);
  assert.equal(item.unit, 'pcs');
  assert.equal(item.productId, productA);

  const foreign = await request
    .post('/api/quotations')
    .set(auth(tokenA))
    .send({ customerId: customerIdA, items: [{ productId: productB, name: 'ignored', quantity: 1 }] });
  assert.equal(foreign.status, 403);
});

test('Expired is derived for Sent quotations past valid_until', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Expire Q Co', email: 'qexp@p.test', password: 'ExpireQ123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'qexp@p.test', 'ExpireQ123!');
  const customerId = insertCustomer(db, companyId);

  const created = await request
    .post('/api/quotations')
    .set(auth(token))
    .send({ customerId, status: 'Sent', validUntil: '2020-01-01', items: [{ name: 'Expired', quantity: 1, unitPrice: 10 }] });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.expired, true);

  const list = await request.get('/api/quotations?status=Expired').set(auth(token));
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.total, 1);
  assert.equal(list.body.data[0].expired, true);
});
