import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function insertCustomer(db, companyId, name = 'Acme Corp') {
  return Number(
    db
      .prepare("INSERT INTO customers (company_id, name, customer_type, status) VALUES (?, ?, 'Company', 'Active')")
      .run(companyId, name).lastInsertRowid
  );
}

// ---------------------------------------------------------------------------
// Sales Order / Quotation price, tax and discount manipulation. The client must
// never be able to influence stored totals: `total`, `subtotal`, `taxAmount`
// and per-item `amount` are not part of any write schema, so they are stripped
// by validation and every write recomputes them server-side from line items.
// ---------------------------------------------------------------------------

test('client-supplied order totals are ignored and recomputed on create', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'Manip Co',
    email: 'omanip@p.test',
    password: 'ManipO123!',
    roleKey: 'business_owner',
  });
  const token = await loginToken(request, 'omanip@p.test', 'ManipO123!');
  const customerId = insertCustomer(db, companyId);

  const created = await request.post('/api/orders').set(auth(token)).send({
    customerId,
    discount: 1,
    subtotal: 0,
    taxAmount: 0,
    total: 1,
    items: [
      { name: 'Consulting', quantity: 2, unitPrice: 100, taxRate: 10, amount: 999999 },
      { name: 'License', quantity: 1, unitPrice: 50, taxRate: 0, amount: 999999 },
    ],
  });
  assert.equal(created.status, 201);
  const o = created.body.data;
  // Server recomputes: 2*100 + 1*50 = 250 subtotal; tax 20; total 250 + 20 - 1.
  assert.equal(o.subtotal, 250);
  assert.equal(o.taxAmount, 20);
  assert.equal(o.total, 269);
  assert.equal(o.items[0].amount, 200);
  assert.equal(o.items[1].amount, 50);
});

test('client-supplied order totals are ignored and recomputed on update', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'Manip2 Co',
    email: 'omanip2@p.test',
    password: 'Manip2O123!',
    roleKey: 'business_owner',
  });
  const token = await loginToken(request, 'omanip2@p.test', 'Manip2O123!');
  const customerId = insertCustomer(db, companyId);

  const created = await request
    .post('/api/orders')
    .set(auth(token))
    .send({ customerId, items: [{ name: 'Widget', quantity: 1, unitPrice: 10 }] });
  const id = created.body.data.id;

  const updated = await request.put(`/api/orders/${id}`).set(auth(token)).send({
    subtotal: 0,
    taxAmount: 0,
    total: 0,
    discount: 0,
    items: [
      { name: 'Big', quantity: 10, unitPrice: 50, taxRate: 10 },
    ],
  });
  assert.equal(updated.status, 200);
  const o = updated.body.data;
  assert.equal(o.subtotal, 500);
  assert.equal(o.taxAmount, 50);
  assert.equal(o.total, 550);
});

test('negative order discount, unitPrice and taxRate are rejected', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'Neg Co',
    email: 'oneg@p.test',
    password: 'NegO123!',
    roleKey: 'business_owner',
  });
  const token = await loginToken(request, 'oneg@p.test', 'NegO123!');
  const customerId = insertCustomer(db, companyId);

  assert.equal(
    (await request.post('/api/orders').set(auth(token)).send({ customerId, discount: -5, items: [{ name: 'X', quantity: 1, unitPrice: 10 }] })).status,
    400
  );
  assert.equal(
    (await request.post('/api/orders').set(auth(token)).send({ customerId, items: [{ name: 'X', quantity: 1, unitPrice: -10 }] })).status,
    400
  );
  assert.equal(
    (await request.post('/api/orders').set(auth(token)).send({ customerId, items: [{ name: 'X', quantity: 1, unitPrice: 10, taxRate: -5 }] })).status,
    400
  );
});

test('client-supplied quotation totals are ignored and recomputed on create', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, {
    companyName: 'QManip Co',
    email: 'qmanip@p.test',
    password: 'QManip123!',
    roleKey: 'business_owner',
  });
  const token = await loginToken(request, 'qmanip@p.test', 'QManip123!');
  const customerId = insertCustomer(db, companyId);

  const created = await request.post('/api/quotations').set(auth(token)).send({
    customerId,
    discount: 1,
    subtotal: 0,
    taxAmount: 0,
    total: 1,
    items: [{ name: 'Consulting', quantity: 2, unitPrice: 100, taxRate: 10, amount: 999999 }],
  });
  assert.equal(created.status, 201);
  const q = created.body.data;
  assert.equal(q.subtotal, 200);
  assert.equal(q.taxAmount, 20);
  assert.equal(q.total, 219); // 200 + 20 - 1
  assert.equal(q.items[0].amount, 200);
});

// ---------------------------------------------------------------------------
// Sensitive error / data exposure. Unknown errors must never leak internals to
// the client in production.
// ---------------------------------------------------------------------------

test('production mode masks internal error details', () => {
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const handlerUrl = pathToFileURL(path.join(serverRoot, 'src/middleware/errorHandler.js')).href;
  const script = `
    process.env.NODE_ENV = 'production';
    import('${handlerUrl}').then(({ errorHandler }) => {
      const captured = {};
      const res = {
        status(code) { captured.status = code; return this; },
        json(body) { captured.body = body; return this; },
      };
      errorHandler(new Error('SECRET_INTERNAL_DETAIL_abc123'), {}, res, () => {});
      console.log(JSON.stringify(captured));
    });
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  const result = JSON.parse(out.trim());
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_ERROR');
  assert.equal(result.body.error.message, 'Internal server error');
  assert.ok(!JSON.stringify(result).includes('SECRET_INTERNAL_DETAIL_abc123'));
});
