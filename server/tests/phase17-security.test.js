import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { initTestApp, loginToken, createCompanyAndUser } from './helpers.js';
import {
  signWebhookHeader,
  verifyWebhookHeader,
  verifyWebhookSignature,
  webhookSecret,
  isMockMode,
} from '../src/services/paymentService.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// Payment webhook integrity: fail-closed secret handling + replay protection.
// ---------------------------------------------------------------------------

test('webhook verification fails closed when no secret is available', () => {
  const body = '{"a":1}';
  const header = signWebhookHeader(body, 'mock-webhook-secret');
  assert.equal(verifyWebhookHeader(body, header, null), false);
  assert.equal(verifyWebhookHeader(body, header, ''), false);
  assert.equal(verifyWebhookSignature(body, header, null), false);
});

test('webhook verification rejects a stale (replayed) timestamp', () => {
  const body = '{"a":1}';
  const t = Math.floor(Date.now() / 1000) - 3600; // one hour old
  const v1 = crypto.createHmac('sha256', webhookSecret()).update(`${t}.${body}`, 'utf8').digest('hex');
  const header = `t=${t},v1=${v1}`;
  assert.equal(verifyWebhookHeader(body, header), false);
});

test('webhook verification rejects a far-future timestamp', () => {
  const body = '{"a":1}';
  const t = Math.floor(Date.now() / 1000) + 3600;
  const v1 = crypto.createHmac('sha256', webhookSecret()).update(`${t}.${body}`, 'utf8').digest('hex');
  const header = `t=${t},v1=${v1}`;
  assert.equal(verifyWebhookHeader(body, header), false);
});

test('webhook verification accepts a fresh timestamp', () => {
  const body = '{"a":1}';
  const header = signWebhookHeader(body);
  assert.equal(verifyWebhookHeader(body, header), true);
});

test('replayed webhook is rejected end-to-end even with a valid signature', async () => {
  const { request } = initTestApp();
  const event = { provider: 'stripe', id: 'evt_replay', type: 'invoice.paid', data: { object: { company_id: 1, invoice_id: 1, amount_paid: 1, payment_intent: 'pi_1' } } };
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000) - 3600;
  const v1 = crypto.createHmac('sha256', webhookSecret()).update(`${t}.${body}`, 'utf8').digest('hex');
  const res = await request
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', `t=${t},v1=${v1}`)
    .send(body);
  assert.equal(res.status, 400);
});

test('a live provider without a webhook secret rejects signatures made with the known mock constant', () => {
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const moduleUrl = pathToFileURL(path.join(serverRoot, 'src/services/paymentService.js')).href;
  const script = `
    process.env.PAYMENT_SECRET_KEY = 'sk_live_real_secret';
    process.env.PAYMENT_WEBHOOK_SECRET = '';
    process.env.PAYMENT_MOCK = '1';
    import('${moduleUrl}').then((m) => {
      const body = '{"a":1}';
      const forged = m.signWebhookHeader(body, 'mock-webhook-secret');
      console.log(JSON.stringify({
        mock: m.isMockMode(),
        secret: m.webhookSecret(),
        accepted: m.verifyWebhookHeader(body, forged),
      }));
    });
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  const result = JSON.parse(out.trim());
  assert.equal(result.mock, false);
  assert.equal(result.secret, null);
  assert.equal(result.accepted, false);
});

test('mock mode is only active when no real provider secret is configured', () => {
  // The unit-test environment configures no PAYMENT_SECRET_KEY, so mock mode
  // is expected to be on and the configured webhook secret must be honoured.
  assert.equal(isMockMode(), true);
  assert.equal(webhookSecret(), 'test-webhook-secret-for-unit-tests');
});

// ---------------------------------------------------------------------------
// Public config endpoint: no unauthenticated tenant enumeration.
// ---------------------------------------------------------------------------

test('anonymous /api/config?companyId= cannot enumerate another tenant', async () => {
  const { request, db, seed } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Secret Co', email: 'secret@b.test', password: 'SecretPass1!', roleKey: 'business_owner' });
  db.prepare("UPDATE companies SET brand_color = '#ff0000' WHERE id = ?").run(companyId);

  const res = await request.get(`/api/config?companyId=${companyId}`);
  assert.equal(res.status, 200);
  // The companyId param is ignored for anonymous callers; the endpoint falls
  // back to the default (first active) company rather than the requested one.
  assert.notEqual(res.body.data.company?.companyId, companyId);
  assert.equal(res.body.data.company?.companyId, seed.companyId);
  assert.notEqual(res.body.data.company?.brandColor, '#ff0000');
});

test('super admin can still preview a specific tenant via /api/config?companyId=', async () => {
  const { request, db } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Preview Co', email: 'preview@b.test', password: 'PreviewPass1!', roleKey: 'business_owner' });
  db.prepare("UPDATE companies SET brand_color = '#00ff00' WHERE id = ?").run(companyId);

  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');
  const res = await request.get(`/api/config?companyId=${companyId}`).set(auth(admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.company.companyId, companyId);
  assert.equal(res.body.data.company.brandColor, '#00ff00');
});

test('a non-super-admin token cannot use /api/config?companyId= to preview another tenant', async () => {
  const { request, db, seed } = initTestApp();
  const { companyId } = createCompanyAndUser(db, { companyName: 'Peek Co', email: 'peek@b.test', password: 'PeekPass1!', roleKey: 'business_owner' });
  db.prepare("UPDATE companies SET brand_color = '#0000ff' WHERE id = ?").run(companyId);
  createCompanyAndUser(db, { companyName: 'Actor Co', email: 'actor@b.test', password: 'ActorPass1!', roleKey: 'business_owner' });
  const actor = await loginToken(request, 'actor@b.test', 'ActorPass1!');

  const res = await request.get(`/api/config?companyId=${companyId}`).set(auth(actor));
  assert.equal(res.status, 200);
  assert.notEqual(res.body.data.company?.companyId, companyId);
  assert.equal(res.body.data.company?.companyId, seed.companyId);
});
