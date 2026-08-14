import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './helpers.js';

test('GET /api/health returns ok status', async () => {
  const { request } = initTestApp();
  const res = await request.get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'ok');
  assert.equal(res.body.data.service, 'sales-crm-api');
});

test('GET /api/health/db reports database connectivity', async () => {
  const { request } = initTestApp();
  const res = await request.get('/api/health/db');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.database, 'ok');
});

test('unknown route returns structured 404', async () => {
  const { request } = initTestApp();
  const res = await request.get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('malformed JSON body returns 400', async () => {
  const { request } = initTestApp();
  const res = await request
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{invalid');
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});
