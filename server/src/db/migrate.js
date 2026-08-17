import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'schema.sql');

/**
 * Idempotently add a column to an existing table if it does not already exist.
 * Preserves data for databases created by earlier releases.
 */
export function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/**
 * Rebuild the `licenses` table when it was created before the `cancelled`
 * lifecycle state and the `past_due` state (and the per-license entitlement
 * overrides) were introduced. SQLite cannot alter a CHECK constraint, so the
 * table is recreated and data copied over. Nothing references `licenses`, so
 * this is safe.
 */
export function migrateLicensesSchema(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'licenses'").get();
  if (!row || !row.sql) return;
  if (row.sql.includes("'cancelled'") && row.sql.includes("'past_due'")) return;

  db.exec('ALTER TABLE licenses RENAME TO licenses_old');
  db.exec(`
    CREATE TABLE licenses (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id       INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
      plan_id          INTEGER REFERENCES plans(id) ON DELETE SET NULL,
      status           TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','suspended','trial','cancelled','past_due')),
      starts_at        TEXT,
      expires_at       TEXT,
      past_due_at      TEXT,
      user_limit       INTEGER,
      modules          TEXT,
      storage_limit_mb INTEGER,
      export_enabled   INTEGER,
      api_enabled      INTEGER,
      billing_cycle    TEXT    CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly','annual')),
      auto_renew       INTEGER NOT NULL DEFAULT 1,
      created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  db.exec(`
    INSERT INTO licenses (id, company_id, plan_id, status, starts_at, expires_at, user_limit, modules, created_by, created_at, updated_at)
      SELECT id, company_id, plan_id, status, starts_at, expires_at, user_limit, modules, created_by, created_at, updated_at FROM licenses_old;
  `);
  db.exec('DROP TABLE licenses_old');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_licenses_plan ON licenses(plan_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
    CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expires_at);
  `);
}

/**
 * Incremental migrations for pre-Phase-2 databases. Safe to run on fresh
 * databases too (columns already exist there, so these become no-ops).
 */
export function applyIncrementalMigrations(db) {
  ensureColumn(db, 'users', 'employee_id', 'TEXT');
  ensureColumn(db, 'users', 'manager_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
  ensureColumn(db, 'users', 'territory', 'TEXT');
  ensureColumn(db, 'users', 'joining_date', 'TEXT');
  ensureColumn(db, 'teams', 'manager_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');

  // White-label branding columns (multi-client phase).
  ensureColumn(db, 'companies', 'brand_color', 'TEXT');
  ensureColumn(db, 'companies', 'favicon_url', 'TEXT');
  ensureColumn(db, 'companies', 'domain', 'TEXT');

  // Tenant management & onboarding (Phase 12).
  ensureColumn(db, 'companies', 'industry', 'TEXT');
  ensureColumn(db, 'users', 'invitation_token', 'TEXT');
  ensureColumn(db, 'users', 'invitation_expires_at', 'TEXT');

  // Temporary credentials (Super Admin "Generate Temporary Credentials"):
  // accounts that must replace their temporary password on first login, with a
  // configurable expiry timestamp.
  ensureColumn(db, 'users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'temp_password_expires_at', 'TEXT');

  // Tenant lifecycle (Phase 15): first-login onboarding completion and
  // explicit activation timestamps.
  ensureColumn(db, 'companies', 'onboarded_at', 'TEXT');
  ensureColumn(db, 'companies', 'activated_at', 'TEXT');

  // Soft delete (Phase 23): a deleted_at marker lets the Super Admin remove a
  // tenant without physically destroying its data (recoverable, auditable).
  ensureColumn(db, 'companies', 'deleted_at', 'TEXT');

  // Plans & entitlements (Phase 13): plan-level entitlements and per-license
  // overrides. The licenses table CHECK is expanded via a rebuild below.
  ensureColumn(db, 'plans', 'storage_limit_mb', 'INTEGER NOT NULL DEFAULT -1');
  ensureColumn(db, 'plans', 'export_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'plans', 'api_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'plans', 'license_duration_days', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'plans', 'trial_days', 'INTEGER NOT NULL DEFAULT 0');
  migrateLicensesSchema(db);
  ensureColumn(db, 'licenses', 'storage_limit_mb', 'INTEGER');
  ensureColumn(db, 'licenses', 'export_enabled', 'INTEGER');
  ensureColumn(db, 'licenses', 'api_enabled', 'INTEGER');
  ensureColumn(db, 'licenses', 'past_due_at', 'TEXT');

  // Online payments & billing (Phase 14): billing cycle / auto-renew settings
  // and provider identifiers on subscription billing records.
  ensureColumn(db, 'plans', 'price_annual', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'licenses', 'billing_cycle', "TEXT CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly','annual'))");
  ensureColumn(db, 'licenses', 'auto_renew', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'subscription_invoices', 'billing_cycle', "TEXT CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly','annual'))");
  ensureColumn(db, 'subscription_invoices', 'provider', 'TEXT');
  ensureColumn(db, 'subscription_invoices', 'provider_id', 'TEXT');
  ensureColumn(db, 'subscription_payments', 'type', "TEXT NOT NULL DEFAULT 'payment' CHECK (type IN ('payment','refund'))");
  ensureColumn(db, 'subscription_payments', 'provider', 'TEXT');
  ensureColumn(db, 'subscription_payments', 'provider_id', 'TEXT');

  // Indexes on columns added above must be created after the columns exist.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_teams_manager ON teams(manager_id);
    CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);
    CREATE INDEX IF NOT EXISTS idx_users_employee ON users(employee_id);
    CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
    CREATE INDEX IF NOT EXISTS idx_companies_deleted ON companies(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_users_invitation ON users(invitation_token);
  `);
}

/**
 * Apply the base schema plus any incremental column migrations.
 * @param {import('node:sqlite').DatabaseSync} [db]
 */
export function migrate(db = getDb()) {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(schema);
    applyIncrementalMigrations(db);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
