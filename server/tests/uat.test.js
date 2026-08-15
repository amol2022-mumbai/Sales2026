import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

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

// ---------------------------------------------------------------------------
// Quotation -> order conversion must honour the accepted quotation snapshot.
// ---------------------------------------------------------------------------

test('order converted from a quotation honours the quoted price even if the product price later changes', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Snap Co', email: 'snap@u.test', password: 'SnapU123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'snap@u.test', 'SnapU123!');
  const customerId = insertCustomer(db, companyId);
  const productId = insertProduct(db, companyId, { name: 'Deluxe Widget', unitPrice: 40, taxRate: 10, unit: 'pcs' });

  const quotation = await request.post('/api/quotations').set(auth(token)).send({
    customerId,
    status: 'Accepted',
    discount: 0,
    items: [{ productId, name: 'ignored', quantity: 3 }],
  });
  assert.equal(quotation.status, 201);
  const q = quotation.body.data;
  assert.equal(q.items[0].unitPrice, 40, 'quotation snapshots the original price');

  // Product price changes after the customer has accepted the quotation.
  db.prepare('UPDATE products SET unit_price = 999 WHERE id = ?').run(productId);

  const converted = await request.post('/api/orders/convert').set(auth(token)).send({ quotationId: q.id });
  assert.equal(converted.status, 201);
  const o = converted.body.data;

  assert.equal(o.items[0].unitPrice, 40, 'order honours the quoted price, not the new catalogue price');
  assert.equal(o.subtotal, q.subtotal);
  assert.equal(o.taxAmount, q.taxAmount);
  assert.equal(o.total, q.total);
});

test('an accepted quotation whose product was removed can still be converted into an order', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Retire Co', email: 'retire@u.test', password: 'RetireU123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'retire@u.test', 'RetireU123!');
  const customerId = insertCustomer(db, companyId);
  const productId = insertProduct(db, companyId, { name: 'Legacy Widget', unitPrice: 15, taxRate: 0, unit: 'pcs' });

  const quotation = await request.post('/api/quotations').set(auth(token)).send({
    customerId,
    status: 'Accepted',
    discount: 0,
    items: [{ productId, name: 'ignored', quantity: 2 }],
  });
  assert.equal(quotation.status, 201);
  const q = quotation.body.data;

  // The product is retired (soft-deleted) after acceptance.
  db.prepare("UPDATE products SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(productId);

  const converted = await request.post('/api/orders/convert').set(auth(token)).send({ quotationId: q.id });
  assert.equal(converted.status, 201);
  assert.equal(converted.body.data.total, q.total, 'order total matches the accepted quotation');
});

// ---------------------------------------------------------------------------
// Accountant role: full collections/orders/reports, read-only elsewhere.
// ---------------------------------------------------------------------------

test('accountant can create invoices, record payments and read collections', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Acc Co', email: 'acc@u.test', password: 'AccU123!', roleKey: 'accountant' });
  const token = await loginToken(request, 'acc@u.test', 'AccU123!');
  const customerId = insertCustomer(db, companyId);

  const invoice = await request.post('/api/collections').set(auth(token)).send({
    customerId,
    amount: 1000,
    dueDate: '2099-12-31',
  });
  assert.equal(invoice.status, 201, 'accountant can create an invoice');
  const inv = invoice.body.data;
  assert.match(inv.invoiceNo, /^INV-\d{6}$/);
  assert.equal(inv.balance, 1000);
  assert.equal(inv.status, 'Unpaid');

  const payment = await request.post('/api/collections/payments').set(auth(token)).send({
    invoiceId: inv.id,
    amount: 400,
    paymentDate: '2099-01-01',
    method: 'Bank Transfer',
  });
  assert.equal(payment.status, 201, 'accountant can record a payment');
  assert.equal(payment.body.data.amount, 400);

  const got = await request.get(`/api/collections/${inv.id}`).set(auth(token));
  assert.equal(got.status, 200);
  assert.equal(got.body.data.paid, 400);
  assert.equal(got.body.data.balance, 600);
  assert.equal(got.body.data.status, 'Partial');

  const list = await request.get('/api/collections').set(auth(token));
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.total, 1);

  const payments = await request.get('/api/collections/payments').set(auth(token));
  assert.equal(payments.status, 200);
  assert.equal(payments.body.meta.total, 1);

  const dashboard = await request.get('/api/collections/dashboard').set(auth(token));
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.data.invoiced, 1000);
  assert.equal(dashboard.body.data.collected, 400);
  assert.equal(dashboard.body.data.outstanding, 600);
});

test('accountant can create, update and delete orders', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'AccOrder Co', email: 'accorder@u.test', password: 'AccOrd123!', roleKey: 'accountant' });
  const token = await loginToken(request, 'accorder@u.test', 'AccOrd123!');
  const customerId = insertCustomer(db, companyId);

  const created = await request.post('/api/orders').set(auth(token)).send({
    customerId,
    items: [{ name: 'Billing Setup', quantity: 2, unitPrice: 50, taxRate: 0 }],
  });
  assert.equal(created.status, 201, 'accountant can create an order');
  const id = created.body.data.id;

  const updated = await request.put(`/api/orders/${id}`).set(auth(token)).send({ status: 'Confirmed' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.status, 'Confirmed');

  const del = await request.delete(`/api/orders/${id}`).set(auth(token));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);
});

test('accountant can read and export reports', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'AccRpt Co', email: 'accrpt@u.test', password: 'AccRpt123!', roleKey: 'accountant' });
  const token = await loginToken(request, 'accrpt@u.test', 'AccRpt123!');
  insertCustomer(db, companyId);

  const types = await request.get('/api/reports/types').set(auth(token));
  assert.equal(types.status, 200);
  assert.ok(types.body.data.some((r) => r.key === 'collections'));

  const report = await request.get('/api/reports/collections').set(auth(token));
  assert.equal(report.status, 200);

  const csv = await request.get('/api/reports/collections/export').set(auth(token));
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);

  const xlsx = await request.get('/api/reports/aging/export?format=xlsx').set(auth(token));
  assert.equal(xlsx.status, 200);
});

test('accountant has read-only access to leads, customers and quotations', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'AccRO Co', email: 'accro@u.test', password: 'AccRO123!', roleKey: 'accountant' });
  const token = await loginToken(request, 'accro@u.test', 'AccRO123!');
  const customerId = insertCustomer(db, companyId);

  assert.equal((await request.get('/api/leads').set(auth(token))).status, 200, 'can read leads');
  assert.equal((await request.post('/api/leads').set(auth(token)).send({ companyName: 'Prospect' })).status, 403, 'cannot create leads');
  assert.equal((await request.post('/api/customers').set(auth(token)).send({ name: 'NewCo', customerType: 'Company' })).status, 403, 'cannot create customers');
  assert.equal(
    (await request.post('/api/quotations').set(auth(token)).send({ customerId, items: [{ name: 'X', quantity: 1, unitPrice: 10 }] })).status,
    403,
    'cannot create quotations'
  );
});
