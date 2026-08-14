import './setup.js';
import supertest from 'supertest';
import bcrypt from 'bcryptjs';
import { openDatabase, setDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import { createApp } from '../src/app.js';

export const TEST_ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL,
  password: process.env.SEED_ADMIN_PASSWORD,
};

export function initTestApp() {
  const db = openDatabase(':memory:');
  setDb(db);
  migrate(db);
  const seed = seedDatabase(db);
  const app = createApp();
  return { db, seed, request: supertest(app) };
}

export async function loginToken(request, email, password) {
  const res = await request.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

/**
 * Directly provision a second company and an active user within it (used to
 * exercise multi-company isolation at the database level).
 */
export function createCompanyAndUser(db, { companyName, email, password, roleKey }) {
  const companyResult = db
    .prepare("INSERT INTO companies (name, slug, currency, timezone, status) VALUES (?, ?, 'USD', 'UTC', 'active')")
    .run(companyName, companyName.toLowerCase().replace(/\s+/g, '-'));
  const companyId = Number(companyResult.lastInsertRowid);
  const role = db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey);
  const userResult = db
    .prepare(
      `INSERT INTO users (company_id, role_id, name, email, password_hash, status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    )
    .run(companyId, role.id, companyName, email.toLowerCase(), bcrypt.hashSync(password, 4));

  return { companyId, userId: Number(userResult.lastInsertRowid) };
}

export function getRoleId(db, key) {
  return db.prepare('SELECT id FROM roles WHERE key = ?').get(key).id;
}

export function addUserToCompany(db, companyId, { name, email, password, roleKey }) {
  const roleId = getRoleId(db, roleKey);
  return db
    .prepare(
      `INSERT INTO users (company_id, role_id, name, email, password_hash, status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    )
    .run(companyId, roleId, name, email.toLowerCase(), bcrypt.hashSync(password, 4));
}

/**
 * Insert a user with the full Phase 2 field set (employee id, team, manager,
 * territory, joining date, status).
 */
export function createUserInCompany(db, companyId, opts) {
  const roleId = getRoleId(db, opts.roleKey);
  const result = db
    .prepare(
      `INSERT INTO users (company_id, role_id, team_id, manager_id, employee_id, name, email, password_hash, territory, joining_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      companyId,
      roleId,
      opts.teamId ?? null,
      opts.managerId ?? null,
      opts.employeeId ?? null,
      opts.name,
      opts.email.toLowerCase(),
      bcrypt.hashSync(opts.password, 4),
      opts.territory ?? null,
      opts.joiningDate ?? null,
      opts.status ?? 'active'
    );
  return Number(result.lastInsertRowid);
}

export function createTeam(db, companyId, { name, leadId = null, managerId = null }) {
  const result = db
    .prepare('INSERT INTO teams (company_id, name, lead_id, manager_id, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(companyId, name, leadId, managerId);
  return Number(result.lastInsertRowid);
}
