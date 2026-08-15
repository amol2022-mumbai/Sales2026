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

test('business_owner can create, list, read, update and delete orders with line items', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'Owner O Co',
    email: 'oowner@p.test',
    password: 'OwnerOPass1!',
    roleKey: 'business_owner',
  });
  const token = await loginToken(request, 'oowner@p.test', 'OwnerOPass1!');
  const customerId = insertCustomer(db, companyId);

  const created = await request.post('/api/orders').set(auth(token)).send({
    customerId,
    status: 'Draft',
    discount: 1,
    items: [
      { name: 'Consulting', quantity: 2, unitPrice: 100, taxRate: 10 },
      { name: 'License', quantity: 1, unitPrice: 50, taxRate: 0 },
    ],
  });
  assert.equal(created.status, 201);
  const o = created.body.data;
  assert.ok(o.id);
  assert.match(o.orderNo, /^ORD-\d{6}$/);
  assert.equal(o.companyId, companyId);
  assert.equal(o.customerId, customerId);
  assert.equal(o.customerName, 'Acme Corp');
  // Consulting: 2*100=200 tax 20; License: 1*50=50 tax 0
  assert.equal(o.subtotal, 250);
  assert.equal(o.taxAmount, 20);
  assert.equal(o.total, 269); // 250 + 20 - 1
  assert.equal(o.items.length, 2);
  assert.equal(o.status, 'Draft');

  const list = await request.get('/api/orders').set(auth(token));
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.total, 1);
  assert.equal(list.body.data[0].orderNo, o.orderNo);

  const got = await request.get(`/api/orders/${o.id}`).set(auth(token));
  assert.equal(got.status, 200);
  assert.equal(got.body.data.customerName, 'Acme Corp');
  assert.equal(got.body.data.items.length, 2);

  const updated = await request.put(`/api/orders/${o.id}`).set(auth(token)).send({ status: 'Confirmed', discount: 20 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.status, 'Confirmed');
  assert.equal(updated.body.data.total, 250); // 250 + 20 - 20

  const del = await request.delete(`/api/orders/${o.id}`).set(auth(token));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);

  assert.equal((await request.get(`/api/orders/${o.id}`).set(auth(token))).status, 404);
});

test('orders are isolated between tenants', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Tenant OA', email: 'oa@p.test', password: 'TenantOA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Tenant OB', email: 'ob@p.test', password: 'TenantOB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'oa@p.test', 'TenantOA123!');
  const tokenB = await loginToken(request, 'ob@p.test', 'TenantOB123!');
  const customerIdA = insertCustomer(db, a.companyId);

  const created = await request
    .post('/api/orders')
    .set(auth(tokenA))
    .send({ customerId: customerIdA, items: [{ name: 'Secret Order', quantity: 1, unitPrice: 10 }] });
  assert.equal(created.status, 201);
  const id = created.body.data.id;

  assert.equal((await request.get('/api/orders').set(auth(tokenB))).body.meta.total, 0, 'tenant B list is empty');
  assert.equal((await request.get(`/api/orders/${id}`).set(auth(tokenB))).status, 403);
  assert.equal((await request.put(`/api/orders/${id}`).set(auth(tokenB)).send({ status: 'Confirmed' })).status, 403);
  assert.equal((await request.delete(`/api/orders/${id}`).set(auth(tokenB))).status, 403);
});

test('client-supplied companyId is ignored for non-super-admin users', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Spoof OA', email: 'osa@p.test', password: 'SpoofOA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Spoof OB', email: 'osb@p.test', password: 'SpoofOB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'osa@p.test', 'SpoofOA123!');
  const customerIdA = insertCustomer(db, a.companyId);

  const created = await request
    .post('/api/orders')
    .set(auth(tokenA))
    .send({ customerId: customerIdA, companyId: b.companyId, items: [{ name: 'Owned', quantity: 1, unitPrice: 10 }] });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.companyId, a.companyId, 'order is always created under the authenticated company');
});

test('view-only roles cannot create, edit or delete orders', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'View O Co', email: 'oview@p.test', password: 'ViewO123!', roleKey: 'business_owner' });
  addUserToCompany(db, a.companyId, { name: 'Read Only', email: 'oreader@p.test', password: 'ReaderO123!', roleKey: 'viewer' });

  const ownerToken = await loginToken(request, 'oview@p.test', 'ViewO123!');
  const readerToken = await loginToken(request, 'oreader@p.test', 'ReaderO123!');
  const customerId = insertCustomer(db, a.companyId);

  const created = await request
    .post('/api/orders')
    .set(auth(ownerToken))
    .send({ customerId, items: [{ name: 'Catalog', quantity: 1, unitPrice: 10 }] });
  const id = created.body.data.id;

  assert.equal((await request.get('/api/orders').set(auth(readerToken))).status, 200);
  assert.equal((await request.get(`/api/orders/${id}`).set(auth(readerToken))).status, 200);
  assert.equal((await request.post('/api/orders').set(auth(readerToken)).send({ customerId, items: [{ name: 'X', quantity: 1, unitPrice: 10 }] })).status, 403);
  assert.equal((await request.put(`/api/orders/${id}`).set(auth(readerToken)).send({ status: 'Confirmed' })).status, 403);
  assert.equal((await request.delete(`/api/orders/${id}`).set(auth(readerToken))).status, 403);
});

test('order validation rejects missing customer, empty items and invalid values', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Val O Co', email: 'oval@p.test', password: 'ValO123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'oval@p.test', 'ValO123!');
  const customerId = insertCustomer(db, companyId);

  assert.equal((await request.post('/api/orders').set(auth(token)).send({ items: [{ name: 'X', quantity: 1, unitPrice: 10 }] })).status, 400);
  assert.equal((await request.post('/api/orders').set(auth(token)).send({ customerId, items: [] })).status, 400);
  assert.equal((await request.post('/api/orders').set(auth(token)).send({ customerId, items: [{ name: 'X', quantity: 1, unitPrice: 10, taxRate: 150 }] })).status, 400);
  assert.equal((await request.post('/api/orders').set(auth(token)).send({ customerId, items: [{ name: 'X', quantity: -1, unitPrice: 10 }] })).status, 400);
  assert.equal((await request.post('/api/orders').set(auth(token)).send({ customerId: 999999, items: [{ name: 'X', quantity: 1, unitPrice: 10 }] })).status, 404);
});

test('module gating blocks orders for tenants without the module', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Gated O Co', email: 'ogated@p.test', password: 'GatedO123!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { modules: ['leads'] });

  const token = await loginToken(request, 'ogated@p.test', 'GatedO123!');
  const res = await request.get('/api/orders').set(auth(token));
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'MODULE_DISABLED');
});

test('order create/update/delete writes audit log entries', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Audit O Co', email: 'oaud@p.test', password: 'AuditO123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'oaud@p.test', 'AuditO123!');
  const customerId = insertCustomer(db, companyId);

  const created = await request.post('/api/orders').set(auth(token)).send({ customerId, items: [{ name: 'Tracked', quantity: 1, unitPrice: 10 }] });
  const id = created.body.data.id;
  await request.put(`/api/orders/${id}`).set(auth(token)).send({ status: 'Confirmed' });
  await request.delete(`/api/orders/${id}`).set(auth(token));

  const creates = db.prepare("SELECT * FROM audit_logs WHERE action = 'order.create' AND company_id = ?").all(companyId);
  const updates = db.prepare("SELECT * FROM audit_logs WHERE action = 'order.update' AND company_id = ?").all(companyId);
  const deletes = db.prepare("SELECT * FROM audit_logs WHERE action = 'order.delete' AND company_id = ?").all(companyId);

  assert.equal(creates.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(deletes.length, 1);
});

test('line items snapshot product fields and reject foreign products', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Prod OA', email: 'opa@p.test', password: 'ProdOA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Prod OB', email: 'opb@p.test', password: 'ProdOB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'opa@p.test', 'ProdOA123!');
  const customerIdA = insertCustomer(db, a.companyId);

  const productA = insertProduct(db, a.companyId, { name: 'Widget A', unitPrice: 25, taxRate: 7, unit: 'pcs' });
  const productB = insertProduct(db, b.companyId, { name: 'Widget B' });

  const created = await request
    .post('/api/orders')
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
    .post('/api/orders')
    .set(auth(tokenA))
    .send({ customerId: customerIdA, items: [{ productId: productB, name: 'ignored', quantity: 1 }] });
  assert.equal(foreign.status, 403);
});

test('an accepted quotation can be converted into a sales order', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Conv Co', email: 'oconv@p.test', password: 'ConvO123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'oconv@p.test', 'ConvO123!');
  const customerId = insertCustomer(db, companyId);

  const quotation = await request.post('/api/quotations').set(auth(token)).send({
    customerId,
    status: 'Accepted',
    discount: 5,
    items: [
      { name: 'Hardware', quantity: 3, unitPrice: 40, taxRate: 10 },
      { name: 'Support', quantity: 1, unitPrice: 200, taxRate: 0 },
    ],
  });
  assert.equal(quotation.status, 201);
  const q = quotation.body.data;

  const converted = await request.post('/api/orders/convert').set(auth(token)).send({ quotationId: q.id });
  assert.equal(converted.status, 201);
  const o = converted.body.data;
  assert.equal(o.quotationId, q.id);
  assert.equal(o.customerId, customerId);
  assert.equal(o.status, 'Confirmed');
  assert.equal(o.items.length, 2);
  assert.equal(o.subtotal, q.subtotal);
  assert.equal(o.taxAmount, q.taxAmount);
  assert.equal(o.discount, q.discount);
  assert.equal(o.total, q.total);

  // Duplicate conversion is rejected.
  const dup = await request.post('/api/orders/convert').set(auth(token)).send({ quotationId: q.id });
  assert.equal(dup.status, 409);
});

test('only accepted quotations can be converted', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Conv2 Co', email: 'oconv2@p.test', password: 'Conv2O123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'oconv2@p.test', 'Conv2O123!');
  const customerId = insertCustomer(db, companyId);

  const draft = await request.post('/api/quotations').set(auth(token)).send({
    customerId,
    status: 'Draft',
    items: [{ name: 'Draft item', quantity: 1, unitPrice: 10 }],
  });
  assert.equal(draft.status, 201);

  const converted = await request.post('/api/orders/convert').set(auth(token)).send({ quotationId: draft.body.data.id });
  assert.equal(converted.status, 409);
});

test('a quotation cannot be converted by another tenant', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'ConvA Co', email: 'ocva@p.test', password: 'ConvA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'ConvB Co', email: 'ocvb@p.test', password: 'ConvB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'ocva@p.test', 'ConvA123!');
  const tokenB = await loginToken(request, 'ocvb@p.test', 'ConvB123!');
  const customerIdA = insertCustomer(db, a.companyId);

  const quotation = await request.post('/api/quotations').set(auth(tokenA)).send({
    customerId: customerIdA,
    status: 'Accepted',
    items: [{ name: 'Cross-tenant', quantity: 1, unitPrice: 10 }],
  });
  assert.equal(quotation.status, 201);

  const converted = await request.post('/api/orders/convert').set(auth(tokenB)).send({ quotationId: quotation.body.data.id });
  assert.equal(converted.status, 403);
});
