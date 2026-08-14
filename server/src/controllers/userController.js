import { getDb } from '../db/connection.js';
import { hashPassword } from '../lib/password.js';
import { notFound, forbidden, conflict, badRequest } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getUserDataScope, buildUserScopeWhere, canViewUser, canManageUser } from '../services/access.js';
import { assertUserLimit, loadTenant } from '../services/licenseService.js';

function userToJson(u) {
  return {
    id: u.id,
    companyId: u.company_id,
    employeeId: u.employee_id,
    roleId: u.role_id,
    teamId: u.team_id,
    managerId: u.manager_id,
    name: u.name,
    email: u.email,
    jobTitle: u.job_title,
    phone: u.phone,
    territory: u.territory,
    joiningDate: u.joining_date,
    avatarUrl: u.avatar_url,
    status: u.status,
    lastLoginAt: u.last_login_at,
    roleKey: u.role_key,
    roleName: u.role_name,
    teamName: u.team_name || null,
    managerName: u.manager_name || null,
    companyName: u.company_name || null,
    createdAt: u.created_at,
  };
}

const USER_SELECT = `
  SELECT u.*, r.key AS role_key, r.name AS role_name, t.name AS team_name,
         m.name AS manager_name, c.name AS company_name
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN teams t ON t.id = u.team_id
  LEFT JOIN users m ON m.id = u.manager_id
  LEFT JOIN companies c ON c.id = u.company_id
`;

// Roles a non-super-admin actor may grant, by actor role.
const GRANTABLE_ROLES = {
  business_owner: ['sales_manager', 'team_leader', 'sales_executive', 'accountant', 'viewer'],
  sales_manager: ['team_leader', 'sales_executive', 'accountant', 'viewer'],
};

function assertRoleAssignable(actor, role) {
  if (actor.isSuperAdmin) return;
  if (role.key === 'super_admin') {
    throw forbidden('Only a Super Admin can assign the Super Admin role');
  }
  if (role.key === 'business_owner' && actor.roleKey !== 'business_owner') {
    throw forbidden('You cannot assign the Business Owner role');
  }
  const allowed = GRANTABLE_ROLES[actor.roleKey] || [];
  if (!allowed.includes(role.key)) {
    throw forbidden(`Your role cannot assign the "${role.name}" role`);
  }
}

function validateEmployeeId(db, companyId, employeeId, excludeId = null) {
  if (!employeeId) return;
  const row = db
    .prepare('SELECT id FROM users WHERE company_id IS ? AND employee_id = ? AND id != ?')
    .get(companyId, employeeId, excludeId ?? -1);
  if (row) throw conflict('An employee with this Employee ID already exists in the company');
}

function assertTeamAssignable(actor, scope, db, teamId, companyId) {
  if (teamId == null) return;
  const team = db.prepare('SELECT id, company_id FROM teams WHERE id = ?').get(teamId);
  if (!team || (companyId != null && team.company_id !== companyId)) {
    throw badRequest('Invalid team');
  }
  if (actor.isSuperAdmin) return;
  if (scope.type === 'teams' && !scope.teamIds.includes(teamId)) {
    throw forbidden('You can only assign users to teams you manage');
  }
}

function assertManagerAssignable(db, managerId, companyId) {
  if (managerId == null) return;
  const manager = db.prepare('SELECT id, company_id, status FROM users WHERE id = ?').get(managerId);
  if (!manager) throw badRequest('Invalid manager');
  if (manager.company_id !== companyId) throw badRequest('Manager must belong to the same company');
}

export const listUsers = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize, search, role, teamId, status, companyId } = req.query;
  const scope = getUserDataScope(req.user);

  const { where: baseWhere, params: baseParams } = buildUserScopeWhere(scope, 'u');

  const clauses = [];
  const params = [...baseParams];

  if (search) {
    clauses.push('(u.name LIKE ? OR u.email LIKE ? OR u.employee_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (role) {
    clauses.push('r.key = ?');
    params.push(role);
  }
  if (teamId) {
    clauses.push('u.team_id = ?');
    params.push(teamId);
  }
  if (status) {
    clauses.push('u.status = ?');
    params.push(status);
  }
  if (companyId && req.user.isSuperAdmin) {
    clauses.push('u.company_id = ?');
    params.push(companyId);
  }

  let where = baseWhere;
  if (clauses.length) {
    where = baseWhere ? `${baseWhere} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;
  }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id ${where}`).get(...params).c;
  const rows = db
    .prepare(`${USER_SELECT} ${where} ORDER BY u.name ASC, u.id ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  return paginated(res, rows.map(userToJson), { page, pageSize, total });
});

export const getUser = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(req.params.id);
  if (!row) throw notFound('User not found');
  const scope = getUserDataScope(req.user);
  if (!canViewUser(scope, row)) throw forbidden('You cannot access this user');
  return ok(res, userToJson(row));
});

export const createUser = asyncHandler(async (req, res) => {
  const db = getDb();
  const { name, email, password, roleId, teamId, managerId, phone, jobTitle, employeeId, territory, joiningDate } =
    req.body;
  const scope = getUserDataScope(req.user);

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) throw conflict('A user with this email already exists');

  const role = db.prepare('SELECT id, key, name FROM roles WHERE id = ?').get(roleId);
  if (!role) throw badRequest('Invalid role');
  assertRoleAssignable(req.user, role);

  const companyId = req.user.isSuperAdmin
    ? req.body.companyId ?? req.user.companyId ?? null
    : req.user.companyId;

  if (!companyId && !req.user.isSuperAdmin) {
    throw badRequest('Your account is not associated with a company');
  }

  assertTeamAssignable(req.user, scope, db, teamId ?? null, companyId);
  assertManagerAssignable(db, managerId ?? null, companyId);
  validateEmployeeId(db, companyId, employeeId);

  if (companyId) {
    assertUserLimit(loadTenant(req.user, companyId), companyId);
  }

  const info = db
    .prepare(
      `INSERT INTO users (company_id, role_id, team_id, manager_id, employee_id, name, email, password_hash, job_title, phone, territory, joining_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    )
    .run(
      companyId,
      roleId,
      teamId ?? null,
      managerId ?? null,
      employeeId ?? null,
      name,
      email,
      hashPassword(password),
      jobTitle ?? null,
      phone ?? null,
      territory ?? null,
      joiningDate ?? null
    );

  req.audit?.('user.create', { entityType: 'user', entityId: info.lastInsertRowid, metadata: { email } });

  const row = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(info.lastInsertRowid);
  return created(res, userToJson(row));
});

export const updateUser = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('User not found');

  const scope = getUserDataScope(req.user);
  if (!canManageUser(scope, row)) throw forbidden('You cannot modify this user');

  const sets = [];
  const values = [];
  const fields = {
    name: 'name',
    email: 'email',
    roleId: 'role_id',
    teamId: 'team_id',
    managerId: 'manager_id',
    status: 'status',
    jobTitle: 'job_title',
    phone: 'phone',
    employeeId: 'employee_id',
    territory: 'territory',
    joiningDate: 'joining_date',
  };

  let targetTeamId = row.team_id;
  let targetCompanyId = row.company_id;

  for (const [input, column] of Object.entries(fields)) {
    if (req.body[input] === undefined) continue;

    if (input === 'roleId') {
      const role = db.prepare('SELECT id, key, name FROM roles WHERE id = ?').get(req.body.roleId);
      if (!role) throw badRequest('Invalid role');
      assertRoleAssignable(req.user, role);
    }
    if (input === 'teamId') {
      targetTeamId = req.body.teamId;
      assertTeamAssignable(req.user, scope, db, req.body.teamId ?? null, targetCompanyId);
    }
    if (input === 'managerId') {
      assertManagerAssignable(db, req.body.managerId ?? null, targetCompanyId);
    }
    if (input === 'email') {
      const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(req.body.email, row.id);
      if (dup) throw conflict('A user with this email already exists');
    }
    if (input === 'employeeId') {
      validateEmployeeId(db, targetCompanyId, req.body.employeeId, row.id);
    }

    sets.push(`${column} = ?`);
    values.push(req.body[input]);
  }

  // Prevent self-deactivation via user edit by non-super-admin (safety).
  if (req.body.status && req.body.status !== 'active' && row.id === req.user.id && !req.user.isSuperAdmin) {
    throw badRequest('You cannot deactivate your own account');
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  req.audit?.('user.update', { entityType: 'user', entityId: row.id, metadata: { fields: Object.keys(fields).filter((k) => req.body[k] !== undefined) } });

  const updated = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(row.id);
  return ok(res, userToJson(updated));
});

export const resetPassword = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('User not found');

  const scope = getUserDataScope(req.user);
  if (!canManageUser(scope, row)) throw forbidden('You cannot modify this user');

  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(req.body.password),
    new Date().toISOString(),
    row.id
  );

  req.audit?.('user.reset_password', { entityType: 'user', entityId: row.id, metadata: { email: row.email } });
  return ok(res, { id: row.id, reset: true });
});

export const setUserStatus = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('User not found');

  const scope = getUserDataScope(req.user);
  if (!canManageUser(scope, row)) throw forbidden('You cannot modify this user');

  if (row.id === req.user.id && req.body.status !== 'active') {
    throw badRequest('You cannot deactivate your own account');
  }

  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(
    req.body.status,
    new Date().toISOString(),
    row.id
  );

  req.audit?.(`user.${req.body.status === 'active' ? 'activate' : 'deactivate'}`, {
    entityType: 'user',
    entityId: row.id,
    metadata: { email: row.email },
  });

  const updated = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(row.id);
  return ok(res, userToJson(updated));
});
