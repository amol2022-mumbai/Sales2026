import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';
import { invoicePaidByInvoiceIds } from '../src/services/collectionService.js';
import { migrate } from '../src/db/migrate.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function insertCustomer(db, companyId, name) {
  const result = db
    .prepare(
      `INSERT INTO customers (company_id, name, contact_person, created_at, updated_at)
       VALUES (?, ?, 'Contact', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
    .run(companyId, name);
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE customers SET customer_no = ? WHERE id = ?').run(`CUST-${String(id).padStart(6, '0')}`, id);
  return id;
}

function insertInvoice(db, companyId, { customerId, amount = 5000, dueDate = '2026-09-15' }) {
  const result = db
    .prepare(
      `INSERT INTO invoices (company_id, customer_id, amount, due_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Unpaid', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
    .run(companyId, customerId, amount, dueDate);
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE invoices SET invoice_no = ? WHERE id = ?').run(`INV-${String(id).padStart(6, '0')}`, id);
  return id;
}

function insertPayment(db, companyId, { invoiceId, customerId, amount, date = '2026-08-20' }) {
  return Number(
    db
      .prepare(
        `INSERT INTO payments (company_id, invoice_id, customer_id, amount, payment_date, method, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'Bank Transfer', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      )
      .run(companyId, invoiceId, customerId, amount, date).lastInsertRowid
  );
}

// ---------------------------------------------------------------------------
// Health / readiness
// ---------------------------------------------------------------------------

test('GET /api/health/ready reports readiness with database ok', async () => {
  const { request } = initTestApp();
  const res = await request.get('/api/health/ready');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'ready');
  assert.equal(res.body.data.database, 'ok');
});

// ---------------------------------------------------------------------------
// Bulk payment aggregation (N+1 elimination helpers)
// ---------------------------------------------------------------------------

test('invoicePaidByInvoiceIds aggregates payments in one pass and handles empty input', async () => {
  const { db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Agg A', email: 'agga@b.test', password: 'AggA123!', roleKey: 'business_owner' });
  const customerId = insertCustomer(db, a.companyId, 'Agg Customer');
  const inv1 = insertInvoice(db, a.companyId, { customerId, amount: 1000 });
  const inv2 = insertInvoice(db, a.companyId, { customerId, amount: 2000 });
  insertPayment(db, a.companyId, { invoiceId: inv1, customerId, amount: 400 });
  insertPayment(db, a.companyId, { invoiceId: inv1, customerId, amount: 600 });
  insertPayment(db, a.companyId, { invoiceId: inv2, customerId, amount: 500 });

  const map = invoicePaidByInvoiceIds(db, [inv1, inv2, 999999]);
  assert.equal(map.get(inv1), 1000);
  assert.equal(map.get(inv2), 500);
  assert.equal(map.has(999999), false);

  assert.deepEqual([...invoicePaidByInvoiceIds(db, []).keys()], []);
});

// ---------------------------------------------------------------------------
// listInvoices bulk balance correctness (page of many invoices)
// ---------------------------------------------------------------------------

test('listInvoices computes balances correctly for a page of many invoices', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'List Co', email: 'listco@b.test', password: 'ListCo123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'listco@b.test', 'ListCo123!');

  const customerId = insertCustomer(db, a.companyId, 'List Customer');
  const expected = {};
  for (let i = 0; i < 35; i += 1) {
    const amount = 1000 + i;
    const invId = insertInvoice(db, a.companyId, { customerId, amount, dueDate: '2026-09-15' });
    const paid = i % 2 === 0 ? 400 : 0;
    if (paid) insertPayment(db, a.companyId, { invoiceId: invId, customerId, amount: paid });
    expected[`INV-${String(invId).padStart(6, '0')}`] = { amount, paid };
  }

  const res = await request.get('/api/collections?pageSize=100').set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.meta.total, 35);
  assert.equal(res.body.data.length, 35);

  for (const inv of res.body.data) {
    const e = expected[inv.invoiceNo];
    assert.ok(e, `unexpected invoice ${inv.invoiceNo}`);
    assert.equal(inv.amount, e.amount);
    assert.equal(inv.paid, e.paid);
    assert.equal(inv.balance, Math.round((e.amount - e.paid) * 100) / 100);
  }
});

// ---------------------------------------------------------------------------
// Aging report bulk balance correctness
// ---------------------------------------------------------------------------

test('aging report buckets outstanding balances correctly for many invoices', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Aging Co', email: 'agingco@b.test', password: 'AgingCo123!', roleKey: 'business_owner' });
  const token = await loginToken(request, 'agingco@b.test', 'AgingCo123!');

  const customerId = insertCustomer(db, a.companyId, 'Aging Customer');
  const invOld = insertInvoice(db, a.companyId, { customerId, amount: 5000, dueDate: '2020-01-01' });
  insertPayment(db, a.companyId, { invoiceId: invOld, customerId, amount: 2000 });
  const invFuture = insertInvoice(db, a.companyId, { customerId, amount: 10000, dueDate: '2999-01-01' });
  insertPayment(db, a.companyId, { invoiceId: invFuture, customerId, amount: 3000 });

  const res = await request.get('/api/reports/aging').set(auth(token));
  assert.equal(res.status, 200);
  const buckets = Object.fromEntries(res.body.data.rows.map((r) => [r.bucket, r.outstanding]));
  assert.equal(buckets['Not due'], 7000);
  assert.equal(buckets['90+ days'], 3000);
});

// ---------------------------------------------------------------------------
// Migration idempotency (transaction wrapper must not break repeat runs)
// ---------------------------------------------------------------------------

test('migrate is idempotent and safe to run repeatedly', async () => {
  const { db } = initTestApp();
  assert.doesNotThrow(() => migrate(db));
  assert.doesNotThrow(() => migrate(db));
  const row = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'invoices'").get();
  assert.equal(row.c, 1);
});

// ---------------------------------------------------------------------------
// Multi-tenant workload isolation
// ---------------------------------------------------------------------------

test('bulk listing and aging are fully isolated across tenants', async () => {
  const { request, db } = initTestApp();
  const a = createCompanyAndUser(db, { companyName: 'Iso A', email: 'isoa@b.test', password: 'IsoA123!', roleKey: 'business_owner' });
  const b = createCompanyAndUser(db, { companyName: 'Iso B', email: 'isob@b.test', password: 'IsoB123!', roleKey: 'business_owner' });
  const tokenA = await loginToken(request, 'isoa@b.test', 'IsoA123!');
  const tokenB = await loginToken(request, 'isob@b.test', 'IsoB123!');

  const custA = insertCustomer(db, a.companyId, 'A Customer');
  const custB = insertCustomer(db, b.companyId, 'B Customer');

  for (let i = 0; i < 25; i += 1) {
    const invA = insertInvoice(db, a.companyId, { customerId: custA, amount: 1000, dueDate: '2020-01-01' });
    insertPayment(db, a.companyId, { invoiceId: invA, customerId: custA, amount: 400 });
  }
  for (let i = 0; i < 15; i += 1) {
    insertInvoice(db, b.companyId, { customerId: custB, amount: 5000, dueDate: '2999-01-01' });
  }

  const listA = await request.get('/api/collections?pageSize=100').set(auth(tokenA));
  assert.equal(listA.body.meta.total, 25, 'tenant A sees only its own invoices');
  for (const inv of listA.body.data) {
    assert.equal(inv.customerName, 'A Customer');
    assert.equal(inv.balance, 600);
  }

  const listB = await request.get('/api/collections?pageSize=100').set(auth(tokenB));
  assert.equal(listB.body.meta.total, 15, 'tenant B sees only its own invoices');
  for (const inv of listB.body.data) {
    assert.equal(inv.customerName, 'B Customer');
    assert.equal(inv.balance, 5000);
  }

  const agingA = await request.get('/api/reports/aging').set(auth(tokenA));
  const bucketsA = Object.fromEntries(agingA.body.data.rows.map((r) => [r.bucket, r.outstanding]));
  assert.equal(bucketsA['90+ days'], 25 * 600, 'tenant A aging reflects only tenant A balances');

  const agingB = await request.get('/api/reports/aging').set(auth(tokenB));
  const bucketsB = Object.fromEntries(agingB.body.data.rows.map((r) => [r.bucket, r.outstanding]));
  assert.equal(bucketsB['Not due'], 15 * 5000, 'tenant B aging reflects only tenant B balances');
});
