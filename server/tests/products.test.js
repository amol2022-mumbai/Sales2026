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

test('business_owner can create, list, read, update and delete products', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'Owner Co',
    email: 'owner@p.test',
    password: 'OwnerPass1!',
    roleKey: 'business_owner',
  });
  const token = await loginToken(request, 'owner@p.test', 'OwnerPass1!');

  const created = await request
    .post('/api/products')
    .set(auth(token))
    .send({ name: 'Pro CRM', sku: 'CRM-01', category: 'Software', unit: 'seat', unitPrice: 29.5, taxRate: 10 });
  assert.equal(created.status, 201);
  const p = created.body.data;
  assert.ok(p.id);
  assert.match(p.productNo, /^PRD-\d{6}$/);
  assert.equal(p.name, 'Pro CRM');
  assert.equal(p.companyId, companyId);
  assert.equal(p.unitPrice, 29.5);
  assert.equal(p.taxRate, 10);
  assert.equal(p.status, 'Active');
  assert.equal(p.sku, 'CRM-01');

  const list = await request.get('/api/products').set(auth(token));
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.total, 1);
  assert.equal(list.body.data[0].name, 'Pro CRM');

  const got = await request.get(`/api/products/${p.id}`).set(auth(token));
  assert.equal(got.status, 200);
  assert.equal(got.body.data.sku, 'CRM-01');

  const updated = await request.put(`/api/products/${p.id}`).set(auth(token)).send({ unitPrice: 39, status: 'Inactive' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.unitPrice, 39);
  assert.equal(updated.body.data.status, 'Inactive');

  const del = await request.delete(`/api/products/${p.id}`).set(auth(token));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);

  assert.equal((await request.get(`/api/products/${p.id}`).set(auth(token))).status, 404);
});

test('products are isolated between tenants', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Tenant A', email: 'a@p.test', password: 'TenantA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Tenant B', email: 'b@p.test', password: 'TenantB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'a@p.test', 'TenantA123!');
  const tokenB = await loginToken(request, 'b@p.test', 'TenantB123!');

  const created = await request.post('/api/products').set(auth(tokenA)).send({ name: 'Secret Product' });
  assert.equal(created.status, 201);
  const id = created.body.data.id;

  const listB = await request.get('/api/products').set(auth(tokenB));
  assert.equal(listB.body.meta.total, 0, 'tenant B list is empty');

  assert.equal((await request.get(`/api/products/${id}`).set(auth(tokenB))).status, 403);
  assert.equal((await request.put(`/api/products/${id}`).set(auth(tokenB)).send({ name: 'Hijack' })).status, 403);
  assert.equal((await request.delete(`/api/products/${id}`).set(auth(tokenB))).status, 403);
});

test('client-supplied companyId is ignored for non-super-admin users', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Spoof A', email: 'sa@p.test', password: 'SpoofA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Spoof B', email: 'sb@p.test', password: 'SpoofB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'sa@p.test', 'SpoofA123!');

  const created = await request.post('/api/products').set(auth(tokenA)).send({ name: 'Owned', companyId: b.companyId });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.companyId, a.companyId, 'product is always created under the authenticated company');
});

test('view-only roles cannot create, edit or delete products', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'View Co', email: 'owner3@p.test', password: 'Owner3P123!', roleKey: 'business_owner' });
  addUserToCompany(db, a.companyId, { name: 'Read Only', email: 'reader@p.test', password: 'ReaderP123!', roleKey: 'viewer' });

  const ownerToken = await loginToken(request, 'owner3@p.test', 'Owner3P123!');
  const readerToken = await loginToken(request, 'reader@p.test', 'ReaderP123!');

  const created = await request.post('/api/products').set(auth(ownerToken)).send({ name: 'Catalog Item' });
  const id = created.body.data.id;

  assert.equal((await request.get('/api/products').set(auth(readerToken))).status, 200);
  assert.equal((await request.get(`/api/products/${id}`).set(auth(readerToken))).status, 200);
  assert.equal((await request.post('/api/products').set(auth(readerToken)).send({ name: 'X' })).status, 403);
  assert.equal((await request.put(`/api/products/${id}`).set(auth(readerToken)).send({ name: 'Y' })).status, 403);
  assert.equal((await request.delete(`/api/products/${id}`).set(auth(readerToken))).status, 403);
});

test('product validation rejects missing name and invalid values', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Val Co', email: 'val@p.test', password: 'ValPass123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'val@p.test', 'ValPass123!');

  assert.equal((await request.post('/api/products').set(auth(token)).send({ sku: 'no-name' })).status, 400);
  assert.equal((await request.post('/api/products').set(auth(token)).send({ name: 'Bad', taxRate: 150 })).status, 400);
  assert.equal((await request.post('/api/products').set(auth(token)).send({ name: 'Bad', unitPrice: -1 })).status, 400);
});

test('module gating blocks products for tenants without the module', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Gated Co', email: 'gated@p.test', password: 'GatedPass1!', roleKey: 'business_owner' });
  insertLicense(db, companyId, { modules: ['leads'] });

  const token = await loginToken(request, 'gated@p.test', 'GatedPass1!');
  const res = await request.get('/api/products').set(auth(token));
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'MODULE_DISABLED');
});

test('product create/update/delete writes audit log entries', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Audit Co', email: 'aud@p.test', password: 'AuditPass1!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'aud@p.test', 'AuditPass1!');

  const created = await request.post('/api/products').set(auth(token)).send({ name: 'Tracked' });
  const id = created.body.data.id;
  await request.put(`/api/products/${id}`).set(auth(token)).send({ name: 'Tracked v2' });
  await request.delete(`/api/products/${id}`).set(auth(token));

  const creates = db.prepare("SELECT * FROM audit_logs WHERE action = 'product.create' AND company_id = ?").all(companyId);
  const updates = db.prepare("SELECT * FROM audit_logs WHERE action = 'product.update' AND company_id = ?").all(companyId);
  const deletes = db.prepare("SELECT * FROM audit_logs WHERE action = 'product.delete' AND company_id = ?").all(companyId);

  assert.equal(creates.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(deletes.length, 1);
});
