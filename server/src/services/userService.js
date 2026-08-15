import { getDb } from '../db/connection.js';

/**
 * Load a user's full auth context: identity + role + flattened permissions.
 * Returns null when the user does not exist.
 */
export function getUserContext(userId) {
  const db = getDb();
  const user = db
    .prepare(
      `SELECT u.id, u.company_id, u.role_id, u.team_id, u.name, u.email,
              u.status, u.job_title, u.phone, u.avatar_url, u.last_login_at,
              u.must_change_password,
              r.key AS role_key, r.name AS role_name, r.is_super_admin
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
    )
    .get(userId);

  if (!user) return null;

  const permissions = user.is_super_admin
    ? []
    : db
        .prepare(
          `SELECT p.key
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = ?`
        )
        .all(user.role_id)
        .map((r) => r.key);

  return {
    id: user.id,
    companyId: user.company_id,
    teamId: user.team_id,
    roleId: user.role_id,
    roleKey: user.role_key,
    roleName: user.role_name,
    isSuperAdmin: Boolean(user.is_super_admin),
    name: user.name,
    email: user.email,
    jobTitle: user.job_title,
    phone: user.phone,
    avatarUrl: user.avatar_url,
    status: user.status,
    lastLoginAt: user.last_login_at,
    mustChangePassword: Boolean(user.must_change_password),
    permissions: new Set(permissions),
  };
}

export function hasPermission(user, permissionKey) {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return user.permissions.has(permissionKey);
}
