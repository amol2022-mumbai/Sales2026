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

  // Indexes on columns added above must be created after the columns exist.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_teams_manager ON teams(manager_id);
    CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);
    CREATE INDEX IF NOT EXISTS idx_users_employee ON users(employee_id);
    CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
    CREATE INDEX IF NOT EXISTS idx_users_invitation ON users(invitation_token);
  `);
}

/**
 * Apply the base schema plus any incremental column migrations.
 * @param {import('node:sqlite').DatabaseSync} [db]
 */
export function migrate(db = getDb()) {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  applyIncrementalMigrations(db);
}
