import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateEnv } from '../src/config/env.js';
import { openDatabase } from '../src/db/connection.js';
import { verifyBackup } from '../scripts/backup.js';

// ---------------------------------------------------------------------------
// Production secret hygiene (validateEnv)
// ---------------------------------------------------------------------------

test('validateEnv flags a missing or placeholder JWT_SECRET', () => {
  assert.equal(validateEnv({ jwtSecret: '' }).length, 1);
  assert.equal(validateEnv({ jwtSecret: 'change-me-to-a-long-random-secret' }).length, 1);
  assert.equal(validateEnv({ jwtSecret: '<REPLACE_WITH_OPENSSL_RAND_HEX_48>' }).length, 1);
  assert.equal(validateEnv({ jwtSecret: 'strong-secret' }).length, 0);
});

test('validateEnv only enforces production checks in production', () => {
  const nonProd = {
    jwtSecret: 'x',
    isProduction: false,
    seedAdminPassword: 'ChangeMe123!',
    seedAdminEmail: '<replace_with_admin_email>',
    seedCompanyName: '<REPLACE_WITH_COMPANY_NAME>',
    paymentSecretKey: 'sk',
    paymentWebhookSecret: '',
  };
  assert.equal(validateEnv(nonProd).length, 0, 'development does not block placeholder configuration');

  const prod = {
    jwtSecret: 'x',
    isProduction: true,
    seedAdminPassword: 'ChangeMe123!',
    paymentSecretKey: '',
    paymentWebhookSecret: '',
  };
  assert.deepEqual(validateEnv(prod), [
    'SEED_ADMIN_PASSWORD is set to a placeholder or default value. Set a strong unique super-admin password in production.',
  ]);
});

test('validateEnv rejects placeholder seed configuration in production', () => {
  const problems = validateEnv({
    jwtSecret: 'x',
    isProduction: true,
    seedAdminPassword: '<REPLACE_WITH_STRONG_ADMIN_PASSWORD>',
    seedAdminEmail: '<replace_with_admin_email>',
    seedCompanyName: '<REPLACE_WITH_COMPANY_NAME>',
  });
  assert.equal(problems.length, 3);
  assert.ok(problems.some((p) => p.includes('SEED_ADMIN_PASSWORD')));
  assert.ok(problems.some((p) => p.includes('SEED_ADMIN_EMAIL')));
  assert.ok(problems.some((p) => p.includes('SEED_COMPANY_NAME')));
});

test('validateEnv rejects default example values in production', () => {
  const problems = validateEnv({
    jwtSecret: 'x',
    isProduction: true,
    seedAdminPassword: 'ChangeMe123!',
    seedAdminEmail: 'admin@example.com',
    seedCompanyName: 'Acme Corp',
  });
  assert.equal(problems.length, 3);
});

test('validateEnv rejects placeholder payment and optional secrets in production', () => {
  const problems = validateEnv({
    jwtSecret: 'x',
    isProduction: true,
    seedAdminPassword: 'strong-password',
    seedAdminEmail: 'admin@real.com',
    seedCompanyName: 'Real Co',
    paymentSecretKey: '<REPLACE_WITH_PAYMENT_SECRET_KEY>',
    paymentWebhookSecret: '<REPLACE_WITH_PAYMENT_WEBHOOK_SECRET>',
    smtpPass: '<REPLACE_WITH_SMTP_APP_PASSWORD>',
    aiApiKey: '<REPLACE_WITH_AI_API_KEY>',
  });
  assert.ok(problems.some((p) => p.includes('PAYMENT_SECRET_KEY')));
  assert.ok(problems.some((p) => p.includes('PAYMENT_WEBHOOK_SECRET')));
  assert.ok(problems.some((p) => p.includes('SMTP_PASS')));
  assert.ok(problems.some((p) => p.includes('AI_API_KEY')));
});

test('validateEnv flags a live payment secret without a webhook secret in production', () => {
  const config = { jwtSecret: 'x', isProduction: true, seedAdminPassword: 'strong-password', paymentSecretKey: 'sk_live', paymentWebhookSecret: '' };
  assert.equal(validateEnv(config).length, 1);
  assert.match(validateEnv(config)[0], /PAYMENT_WEBHOOK_SECRET/);
});

test('validateEnv passes a fully configured production environment', () => {
  const config = {
    jwtSecret: 'strong-secret',
    isProduction: true,
    seedAdminName: 'Super Admin',
    seedAdminEmail: 'admin@realcompany.com',
    seedAdminPassword: 'strong-password',
    seedCompanyName: 'Real Company',
    paymentSecretKey: 'sk_live',
    paymentWebhookSecret: 'whsec_123',
    smtpPass: '',
    aiApiKey: '',
  };
  assert.equal(validateEnv(config).length, 0);
});

// ---------------------------------------------------------------------------
// Backup verification
// ---------------------------------------------------------------------------

test('verifyBackup accepts a consistent SQLite file and rejects corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-backup-'));
  const source = path.join(dir, 'source.db');
  const good = path.join(dir, 'good.db');
  const bad = path.join(dir, 'bad.db');

  const db = openDatabase(source);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);');
  db.prepare('INSERT INTO t (name) VALUES (?)').run('hello');
  db.exec(`VACUUM INTO '${good.replace(/'/g, "''")}';`);
  db.close();

  const ok = verifyBackup(good);
  assert.equal(ok.ok, true);
  assert.ok(ok.tableCount >= 1);

  // A non-SQLite file must be reported as inconsistent.
  fs.writeFileSync(bad, 'this is not a sqlite database');
  const corrupt = verifyBackup(bad);
  assert.equal(corrupt.ok, false);

  fs.rmSync(dir, { recursive: true, force: true });
});
