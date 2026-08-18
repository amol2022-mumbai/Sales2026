import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { initTestApp } from './helpers.js';
import { resolveDotenvPath, repoRoot } from '../src/config/env.js';
import { openDatabase } from '../src/db/connection.js';

// ---------------------------------------------------------------------------
// C1: environment configuration must resolve from the repository root,
// independent of the process working directory (npm -w runs with cwd=server/).
// ---------------------------------------------------------------------------

test('dotenv path is anchored to the repository root, not the working directory', () => {
  assert.equal(resolveDotenvPath(), path.join(repoRoot, '.env'));
  assert.notEqual(path.dirname(resolveDotenvPath()), process.cwd());
});

test('env.js resolves .env from the repo root even when spawned from server/', () => {
  const envJsUrl = pathToFileURL(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'config', 'env.js')
  ).href;
  // Reproduce the exact deployment scenario: process working directory is the
  // server workspace, which contains a stale development server/.env.
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const script = `import('${envJsUrl}').then(({ resolveDotenvPath }) => console.log(resolveDotenvPath()));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: serverDir,
    encoding: 'utf8',
  });
  assert.equal(out.trim(), path.join(repoRoot, '.env'));
});

test('env loading honours DOTENV_CONFIG_PATH and ignores a cwd .env file', () => {
  const envJsUrl = pathToFileURL(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'config', 'env.js')
  ).href;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-env-'));
  const cwd = path.join(tmp, 'server');
  fs.mkdirSync(cwd, { recursive: true });
  // A decoy .env in the working directory (mirrors the stale server/.env bug).
  fs.writeFileSync(path.join(cwd, '.env'), 'NODE_ENV=development\nC1_MARKER=from-cwd\n');
  const overrideFile = path.join(tmp, 'root', '.env');
  fs.mkdirSync(path.dirname(overrideFile), { recursive: true });
  fs.writeFileSync(overrideFile, 'NODE_ENV=production\nC1_MARKER=from-override\n');

  const script = `
    delete process.env.NODE_ENV;
    process.env.DOTENV_CONFIG_PATH = ${JSON.stringify(overrideFile)};
    import('${envJsUrl}').then(({ env }) => {
      console.log(JSON.stringify({ nodeEnv: env.nodeEnv, marker: process.env.C1_MARKER }));
    });
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    encoding: 'utf8',
  });
  const result = JSON.parse(out.trim());
  assert.equal(result.nodeEnv, 'production');
  assert.equal(result.marker, 'from-override');

  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// M1: anonymous /api/config must expose branding only.
// ---------------------------------------------------------------------------

test('anonymous /api/config exposes branding only (no PII, license or limits)', async () => {
  const { request, db, seed } = initTestApp();
  db.prepare(
    `UPDATE companies SET
       email = 'secret@acme.test',
       phone = '+1-555-0100',
       website = 'https://secret.example',
       address = '1 Secret St',
       city = 'Nowhere',
       state = 'NA',
       country = 'US',
       postal_code = '00000'
     WHERE id = ?`
  ).run(seed.companyId);

  const res = await request.get('/api/config');
  assert.equal(res.status, 200);

  const company = res.body.data.company;
  assert.ok(company);
  assert.equal(company.companyId, seed.companyId);
  assert.ok(company.name);

  // Branding fields are present.
  for (const key of ['name', 'domain', 'logoUrl', 'faviconUrl', 'brandColor']) {
    assert.ok(key in company, `expected branding field ${key}`);
  }

  // PII, license, subscription and user-limit fields must never be exposed.
  const forbidden = [
    'email',
    'phone',
    'website',
    'address',
    'city',
    'state',
    'country',
    'postalCode',
    'license',
    'lifecycleStatus',
    'currency',
    'timezone',
    'onboardedAt',
    'activatedAt',
  ];
  for (const key of forbidden) {
    assert.ok(!(key in company), `must not expose ${key}`);
  }
  assert.ok(!('license' in res.body.data), 'must not expose license at top level');
});

// ---------------------------------------------------------------------------
// M2: SQLite data directory and file must be created with restricted modes.
// ---------------------------------------------------------------------------

test('openDatabase creates the data directory (0700) and DB file (0600)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-dbperms-'));
  const dbPath = path.join(tmp, 'nested', 'crm.db');
  const db = openDatabase(dbPath);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY);');
  db.close();

  const dirMode = fs.statSync(path.dirname(dbPath)).mode & 0o777;
  const dbMode = fs.statSync(dbPath).mode & 0o777;
  assert.equal(dirMode, 0o700);
  assert.equal(dbMode, 0o600);

  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// L1: unknown routes must not echo query strings (which may carry secrets).
// ---------------------------------------------------------------------------

test('notFoundHandler does not echo the query string', async () => {
  const { request } = initTestApp();
  const res = await request.get('/api/does-not-exist?token=SECRET_TOKEN_123&x=1');
  assert.equal(res.status, 404);
  assert.ok(!res.body.error.message.includes('SECRET_TOKEN_123'));
  assert.ok(!res.body.error.message.includes('token='));
  assert.ok(!res.body.error.message.includes('?'));
});
