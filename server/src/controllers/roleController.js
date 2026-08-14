import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest } from '../lib/httpError.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const listRoles = asyncHandler(async (req, res) => {
  const db = getDb();

  let rows;
  if (req.user.isSuperAdmin) {
    rows = db.prepare('SELECT id, key, name, description, is_super_admin FROM roles ORDER BY id').all();
  } else {
    rows = db
      .prepare("SELECT id, key, name, description, is_super_admin FROM roles WHERE key != 'super_admin' ORDER BY id")
      .all();
  }

  return ok(
    res,
    rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSuperAdmin: Boolean(r.is_super_admin),
    }))
  );
});

export const getRole = asyncHandler(async (req, res) => {
  const db = getDb();
  const role = db
    .prepare('SELECT id, key, name, description, is_super_admin FROM roles WHERE id = ?')
    .get(req.params.id);
  if (!role) throw notFound('Role not found');

  if (!req.user.isSuperAdmin && role.key === 'super_admin') throw notFound('Role not found');

  const perms = db
    .prepare(
      `SELECT p.key, p.module, p.action, p.name
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.module, p.action`
    )
    .all(role.id);

  return ok(res, {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSuperAdmin: Boolean(role.is_super_admin),
    permissions: perms,
  });
});

/**
 * Full permission catalog grouped by module (for the role editor matrix).
 */
export const listPermissions = asyncHandler(async (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT key, module, action, name, sort_order FROM permissions ORDER BY module, sort_order')
    .all();

  const grouped = [];
  const byModule = new Map();
  for (const p of rows) {
    if (!byModule.has(p.module)) {
      byModule.set(p.module, { module: p.module, permissions: [] });
      grouped.push(byModule.get(p.module));
    }
    byModule.get(p.module).permissions.push({ key: p.key, action: p.action, name: p.name });
  }

  return ok(res, { modules: grouped, actions: ['view', 'create', 'edit', 'delete', 'export', 'approve', 'assign', 'manage'] });
});

/**
 * Replace a role's permission set (super admin only; the implicit
 * super_admin role cannot be edited).
 */
export const updateRolePermissions = asyncHandler(async (req, res) => {
  const db = getDb();
  const role = db.prepare('SELECT id, key, is_super_admin FROM roles WHERE id = ?').get(req.params.id);
  if (!role) throw notFound('Role not found');
  if (role.is_super_admin) throw badRequest('The Super Admin role has unrestricted access and cannot be edited');

  const { permissionKeys } = req.body;

  const placeholders = permissionKeys.map(() => '?').join(', ');
  const validKeys = new Set(
    db.prepare(`SELECT key FROM permissions WHERE key IN (${placeholders})`).all(...permissionKeys).map((r) => r.key)
  );
  const unknown = permissionKeys.filter((k) => !validKeys.has(k));
  if (unknown.length) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);

  db.exec('BEGIN');
  db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(role.id);
  const insert = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, (SELECT id FROM permissions WHERE key = ?))');
  for (const key of permissionKeys) {
    insert.run(role.id, key);
  }
  db.exec('COMMIT');

  req.audit?.('role.permissions_update', {
    entityType: 'role',
    entityId: role.id,
    metadata: { roleKey: role.key, count: permissionKeys.length },
  });

  const perms = db
    .prepare(
      `SELECT p.key, p.module, p.action, p.name
       FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ? ORDER BY p.module, p.action`
    )
    .all(role.id);

  return ok(res, { id: role.id, permissions: perms });
});
