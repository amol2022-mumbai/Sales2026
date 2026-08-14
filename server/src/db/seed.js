import bcrypt from 'bcryptjs';
import { migrate } from './migrate.js';
import { getDb } from './connection.js';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from './permissions.js';
import { env } from '../config/env.js';

// Bump when default role->permission mappings change in a breaking way so that
// existing databases are reconciled once (preserving later manual edits).
const SEED_VERSION = '3';
const SEED_VERSION_KEY = 'seed_version';

/**
 * Seed foundational data (roles, permissions, role_permissions) and, when
 * absent, a default company and super admin. Idempotent by design.
 *
 * Role->permission defaults are written authoritatively on first seed / version
 * bump, then additively afterwards so super-admin customizations survive.
 * @param {import('node:sqlite').DatabaseSync} [db]
 */
export function seedDatabase(db = getDb()) {
  migrate(db);

  db.exec('BEGIN');

  // -- Roles ----------------------------------------------------------------
  const insertRole = db.prepare(`
    INSERT INTO roles (key, name, description, is_super_admin)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      is_super_admin = excluded.is_super_admin,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);
  for (const role of ROLES) {
    insertRole.run(role.key, role.name, role.description, role.is_super_admin);
  }

  // -- Permissions ----------------------------------------------------------
  const insertPermission = db.prepare(`
    INSERT INTO permissions (key, module, action, name, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      module = excluded.module,
      action = excluded.action,
      name = excluded.name,
      sort_order = excluded.sort_order
  `);
  for (const p of PERMISSIONS) {
    insertPermission.run(p.key, p.module, p.action, p.name, p.description || null, p.sort_order);
  }

  // -- Role permissions -----------------------------------------------------
  const roleById = db.prepare('SELECT id FROM roles WHERE key = ?');
  const permissionByKey = db.prepare('SELECT id FROM permissions WHERE key = ?');
  const insertRolePermission = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    VALUES (?, ?)
  `);

  const currentVersion = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(SEED_VERSION_KEY);

  if (currentVersion?.value !== SEED_VERSION) {
    // Authoritative rebuild of default mappings (first run or version bump).
    db.prepare(
      'DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE is_super_admin = 0)'
    ).run();
  }

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roleById.get(roleKey);
    if (!role) continue;
    for (const permKey of permissionKeys) {
      const perm = permissionByKey.get(permKey);
      if (!perm) continue;
      insertRolePermission.run(role.id, perm.id);
    }
  }

  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SEED_VERSION_KEY, SEED_VERSION);

  // -- Default plans --------------------------------------------------------
  const insertPlan = db.prepare(`
    INSERT INTO plans (key, name, description, user_limit, modules, price_monthly, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      user_limit = excluded.user_limit,
      modules = excluded.modules,
      price_monthly = excluded.price_monthly,
      sort_order = excluded.sort_order,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);
  const DEFAULT_PLANS = [
    {
      key: 'basic',
      name: 'Basic',
      description: 'For small teams getting started with sales tracking.',
      userLimit: 5,
      modules: ['dashboard', 'leads', 'customers', 'pipeline', 'followups'],
      price: 0,
      sort: 1,
    },
    {
      key: 'professional',
      name: 'Professional',
      description: 'For growing sales teams with reporting and AI assistance.',
      userLimit: 20,
      modules: ['dashboard', 'leads', 'customers', 'pipeline', 'followups', 'sales', 'targets', 'reports', 'ai_assistant'],
      price: 49,
      sort: 2,
    },
    {
      key: 'enterprise',
      name: 'Enterprise',
      description: 'Unlimited access across the entire platform.',
      userLimit: -1,
      modules: null,
      price: 99,
      sort: 3,
    },
    {
      key: 'custom',
      name: 'Custom',
      description: 'Tailored plan with per-tenant feature overrides.',
      userLimit: -1,
      modules: null,
      price: 0,
      sort: 4,
    },
  ];
  for (const plan of DEFAULT_PLANS) {
    insertPlan.run(
      plan.key,
      plan.name,
      plan.description,
      plan.userLimit,
      plan.modules ? JSON.stringify(plan.modules) : null,
      plan.price,
      plan.sort
    );
  }

  // -- Default company + super admin ---------------------------------------
  let company = db.prepare('SELECT id FROM companies ORDER BY id LIMIT 1').get();
  if (!company) {
    const result = db
      .prepare(
        `INSERT INTO companies (name, slug, currency, timezone, status)
         VALUES (?, ?, 'USD', 'UTC', 'active')`
      )
      .run(env.seedCompanyName, slugify(env.seedCompanyName));
    company = { id: result.lastInsertRowid };
  }

  // -- Default license for the seed company (fully enabled) -----------------
  // A permissive license keeps single-tenant / self-hosted behaviour identical
  // while establishing the license record the Super Admin manages later.
  const hasLicense = db.prepare('SELECT id FROM licenses WHERE company_id = ?').get(company.id);
  if (!hasLicense) {
    const enterprisePlan = db.prepare("SELECT id FROM plans WHERE key = 'enterprise'").get();
    db.prepare(
      `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, user_limit, modules)
       VALUES (?, ?, 'active', ?, NULL, NULL, NULL)`
    ).run(company.id, enterprisePlan?.id ?? null, new Date().toISOString().slice(0, 10));
  }

  const superAdminRole = roleById.get('super_admin');
  const existingAdmin = db
    .prepare('SELECT id FROM users WHERE role_id = ? LIMIT 1')
    .get(superAdminRole.id);

  if (!existingAdmin) {
    const hash = bcrypt.hashSync(env.seedAdminPassword, 12);
    db.prepare(
      `INSERT INTO users (company_id, role_id, name, email, password_hash, job_title, status)
       VALUES (NULL, ?, ?, ?, ?, 'Super Admin', 'active')`
    ).run(superAdminRole.id, env.seedAdminName, env.seedAdminEmail.toLowerCase(), hash);
  }

  db.exec('COMMIT');

  return {
    roles: ROLES.length,
    permissions: PERMISSIONS.length,
    companyId: company.id,
    adminEmail: env.seedAdminEmail,
  };
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company'
  );
}

// CLI entry point: `npm run seed`.
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  try {
    const result = seedDatabase();
    console.log('Database seeded successfully.');
    console.log(`  roles: ${result.roles}`);
    console.log(`  permissions: ${result.permissions}`);
    console.log(`  company id: ${result.companyId}`);
    console.log(`  super admin: ${result.adminEmail}`);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}
