import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getUserDataScope, buildTeamScopeWhere, canViewTeam, canManageTeam } from '../services/access.js';

const TEAM_SELECT = `
  SELECT t.*, lead.name AS lead_name, mgr.name AS manager_name,
         (SELECT COUNT(*) FROM users m WHERE m.team_id = t.id) AS member_count
  FROM teams t
  LEFT JOIN users lead ON lead.id = t.lead_id
  LEFT JOIN users mgr ON mgr.id = t.manager_id
`;

function teamToJson(t) {
  return {
    id: t.id,
    companyId: t.company_id,
    name: t.name,
    description: t.description,
    leadId: t.lead_id,
    leadName: t.lead_name || null,
    managerId: t.manager_id,
    managerName: t.manager_name || null,
    isActive: Boolean(t.is_active),
    memberCount: t.member_count,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

function memberToJson(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    employeeId: u.employee_id,
    roleId: u.role_id,
    roleKey: u.role_key,
    roleName: u.role_name,
    status: u.status,
    territory: u.territory,
  };
}

const MEMBER_SELECT = `
  SELECT u.*, r.key AS role_key, r.name AS role_name
  FROM users u JOIN roles r ON r.id = u.role_id
`;

function assertTeamUserAssignable(db, actor, scope, team, userId, companyId) {
  if (actor.isSuperAdmin) return;
  const user = db.prepare('SELECT id, company_id, team_id FROM users WHERE id = ?').get(userId);
  if (!user) throw badRequest('Invalid user');
  if (companyId != null && user.company_id !== companyId) {
    throw badRequest('User does not belong to this company');
  }
  if (scope.type === 'teams' && !scope.teamIds.includes(team.id)) {
    throw forbidden('You can only manage members of teams you manage');
  }
}

export const listTeams = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize, search, isActive } = req.query;
  const scope = getUserDataScope(req.user);
  const { where: baseWhere, params: baseParams } = buildTeamScopeWhere(scope, 't');

  const clauses = [];
  const params = [...baseParams];
  if (search) {
    clauses.push('t.name LIKE ?');
    params.push(`%${search}%`);
  }
  if (isActive === 'true') clauses.push('t.is_active = 1');
  if (isActive === 'false') clauses.push('t.is_active = 0');

  let where = baseWhere;
  if (clauses.length) where = baseWhere ? `${baseWhere} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM teams t ${where}`).get(...params).c;
  const rows = db
    .prepare(`${TEAM_SELECT} ${where} ORDER BY t.name ASC, t.id ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  return paginated(res, rows.map(teamToJson), { page, pageSize, total });
});

export const getTeam = asyncHandler(async (req, res) => {
  const db = getDb();
  const team = db.prepare(`${TEAM_SELECT} WHERE t.id = ?`).get(req.params.id);
  if (!team) throw notFound('Team not found');

  const scope = getUserDataScope(req.user);
  if (!canViewTeam(scope, team)) throw forbidden('You cannot access this team');

  const members = db
    .prepare(`${MEMBER_SELECT} WHERE u.team_id = ? ORDER BY u.name`)
    .all(team.id);

  return ok(res, { ...teamToJson(team), members: members.map(memberToJson) });
});

export const createTeam = asyncHandler(async (req, res) => {
  const db = getDb();
  const { name, description, leadId, managerId } = req.body;

  const companyId = req.user.isSuperAdmin ? req.body.companyId ?? req.user.companyId ?? null : req.user.companyId;
  if (!companyId) throw badRequest('A company is required to create a team');

  if (leadId != null) {
    const lead = db.prepare('SELECT id, company_id FROM users WHERE id = ?').get(leadId);
    if (!lead || lead.company_id !== companyId) throw badRequest('Team leader must belong to this company');
  }
  if (managerId != null) {
    const mgr = db.prepare('SELECT id, company_id FROM users WHERE id = ?').get(managerId);
    if (!mgr || mgr.company_id !== companyId) throw badRequest('Manager must belong to this company');
  }

  const info = db
    .prepare(
      `INSERT INTO teams (company_id, name, description, lead_id, manager_id, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(companyId, name, description ?? null, leadId ?? null, managerId ?? null);

  req.audit?.('team.create', { entityType: 'team', entityId: info.lastInsertRowid, metadata: { name } });

  const team = db.prepare(`${TEAM_SELECT} WHERE t.id = ?`).get(info.lastInsertRowid);
  return created(res, teamToJson(team));
});

export const updateTeam = asyncHandler(async (req, res) => {
  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) throw notFound('Team not found');

  const scope = getUserDataScope(req.user);
  if (!canManageTeam(scope, team)) throw forbidden('You cannot modify this team');

  if (req.body.leadId !== undefined && req.body.leadId != null) {
    const lead = db.prepare('SELECT id, company_id FROM users WHERE id = ?').get(req.body.leadId);
    if (!lead || lead.company_id !== team.company_id) throw badRequest('Team leader must belong to this company');
  }
  if (req.body.managerId !== undefined && req.body.managerId != null) {
    const mgr = db.prepare('SELECT id, company_id FROM users WHERE id = ?').get(req.body.managerId);
    if (!mgr || mgr.company_id !== team.company_id) throw badRequest('Manager must belong to this company');
  }

  const sets = [];
  const values = [];
  const fields = {
    name: 'name',
    description: 'description',
    leadId: 'lead_id',
    managerId: 'manager_id',
  };
  for (const [input, column] of Object.entries(fields)) {
    if (req.body[input] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(req.body[input]);
    }
  }
  if (req.body.isActive !== undefined) {
    sets.push('is_active = ?');
    values.push(req.body.isActive ? 1 : 0);
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(team.id);
    db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  req.audit?.('team.update', { entityType: 'team', entityId: team.id });

  const updated = db.prepare(`${TEAM_SELECT} WHERE t.id = ?`).get(team.id);
  return ok(res, teamToJson(updated));
});

export const addTeamMembers = asyncHandler(async (req, res) => {
  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) throw notFound('Team not found');

  const scope = getUserDataScope(req.user);
  if (!canManageTeam(scope, team)) throw forbidden('You cannot modify this team');

  const { userIds } = req.body;
  for (const userId of userIds) {
    assertTeamUserAssignable(db, req.user, scope, team, userId, team.company_id);
  }

  db.exec('BEGIN');
  const stmt = db.prepare('UPDATE users SET team_id = ?, updated_at = ? WHERE id = ? AND company_id = ?');
  for (const userId of userIds) {
    stmt.run(team.id, new Date().toISOString(), userId, team.company_id);
  }
  db.exec('COMMIT');

  req.audit?.('team.add_members', { entityType: 'team', entityId: team.id, metadata: { userIds } });

  const members = db
    .prepare(`${MEMBER_SELECT} WHERE u.team_id = ? ORDER BY u.name`)
    .all(team.id);
  return ok(res, { id: team.id, members: members.map(memberToJson) });
});

export const removeTeamMember = asyncHandler(async (req, res) => {
  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) throw notFound('Team not found');

  const scope = getUserDataScope(req.user);
  if (!canManageTeam(scope, team)) throw forbidden('You cannot modify this team');

  const member = db.prepare('SELECT id FROM users WHERE id = ? AND team_id = ?').get(req.params.userId, team.id);
  if (!member) throw badRequest('User is not a member of this team');

  db.prepare('UPDATE users SET team_id = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), req.params.userId);

  if (team.lead_id === req.params.userId) {
    db.prepare('UPDATE teams SET lead_id = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), team.id);
  }
  if (team.manager_id === req.params.userId) {
    db.prepare('UPDATE teams SET manager_id = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), team.id);
  }

  req.audit?.('team.remove_member', { entityType: 'team', entityId: team.id, metadata: { userId: req.params.userId } });

  const members = db
    .prepare(`${MEMBER_SELECT} WHERE u.team_id = ? ORDER BY u.name`)
    .all(team.id);
  return ok(res, { id: team.id, members: members.map(memberToJson) });
});
