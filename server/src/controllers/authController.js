import { getDb } from '../db/connection.js';
import bcrypt from 'bcryptjs';
import { verifyPassword, hashPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { badRequest, unauthorized } from '../lib/httpError.js';
import { ok } from '../lib/response.js';
import { getUserContext } from '../services/userService.js';
import { loadTenant, buildTenantPayload } from '../services/licenseService.js';
import { asyncHandler } from '../lib/asyncHandler.js';

// A precomputed bcrypt hash used to keep the login path roughly constant-time
// when the email does not exist, reducing user-enumeration via timing.
const DUMMY_HASH = bcrypt.hashSync('invalid-password-placeholder', 4);

export function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    companyId: user.companyId,
    roleId: user.roleId,
    roleKey: user.roleKey,
    roleName: user.roleName,
    isSuperAdmin: user.isSuperAdmin,
    jobTitle: user.jobTitle,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    mustChangePassword: Boolean(user.mustChangePassword),
    permissions: user.isSuperAdmin ? ['*'] : [...user.permissions].sort(),
  };
}

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const db = getDb();

  const row = db
    .prepare(
      `SELECT id, password_hash, status, company_id, must_change_password, temp_password_expires_at
       FROM users WHERE email = ?`
    )
    .get(email);

  // Constant-time-ish behaviour: reject uniformly regardless of reason. When
  // the account does not exist, still run bcrypt against a dummy hash so that
  // unknown emails do not return noticeably faster than wrong passwords.
  if (!row) {
    bcrypt.compareSync(password, DUMMY_HASH);
    req.audit?.('auth.login_failed', { entityType: 'user', metadata: { email: String(email).toLowerCase(), reason: 'unknown_email' } });
    throw unauthorized('Invalid email or password');
  }
  if (!verifyPassword(password, row.password_hash)) {
    req.audit?.('auth.login_failed', { entityType: 'user', entityId: row.id, companyId: row.company_id ?? null, metadata: { email: String(email).toLowerCase(), reason: 'invalid_password' } });
    throw unauthorized('Invalid email or password');
  }
  if (row.status !== 'active') {
    req.audit?.('auth.login_failed', { entityType: 'user', entityId: row.id, companyId: row.company_id ?? null, metadata: { email: String(email).toLowerCase(), reason: 'inactive_account' } });
    throw unauthorized('Account is not active');
  }

  const now = new Date().toISOString();

  // Temporary credentials are single-use only while valid: once the expiry
  // window has passed the generated password no longer grants access and the
  // Super Admin must issue new credentials.
  if (row.must_change_password) {
    if (!row.temp_password_expires_at || row.temp_password_expires_at < now) {
      req.audit?.('auth.login_failed', { entityType: 'user', entityId: row.id, companyId: row.company_id ?? null, metadata: { email: String(email).toLowerCase(), reason: 'temp_password_expired' } });
      throw unauthorized('Your temporary password has expired. Please contact your administrator for new credentials.');
    }
  }

  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);

  const user = getUserContext(row.id);

  // Soft-deleted companies cannot authenticate: their users are blocked at
  // login, independent of the per-request tenant enforcement.
  if (user.companyId) {
    const company = db.prepare('SELECT deleted_at FROM companies WHERE id = ?').get(user.companyId);
    if (company?.deleted_at) {
      req.audit?.('auth.login_failed', { entityType: 'user', entityId: user.id, companyId: user.companyId, metadata: { email: user.email, reason: 'deleted_company' } });
      throw unauthorized('This account has been deleted. Please contact support.');
    }
  }

  req.audit?.('auth.login', { entityType: 'user', entityId: user.id, companyId: user.companyId ?? null, metadata: { email: user.email } });

  const token = signToken({ sub: user.id });

  return ok(res, { token, user: serializeUser(user), tenant: buildTenantPayload(loadTenant(user)) });
});

export const me = asyncHandler(async (req, res) => {
  return ok(res, { user: serializeUser(req.user), tenant: buildTenantPayload(req.tenant) });
});

// Public onboarding endpoint: a Company Admin who was invited by a Super Admin
// sets their own password using the one-time invitation token, after which
// their account becomes active and they are logged in.
export const acceptInvite = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const db = getDb();

  const row = db.prepare('SELECT * FROM users WHERE invitation_token = ?').get(token);
  if (!row) {
    req.audit?.('auth.accept_invite_failed', { metadata: { reason: 'invalid_token' } });
    throw badRequest('This invitation is invalid or has already been used');
  }
  if (row.invitation_expires_at && row.invitation_expires_at < new Date().toISOString()) {
    req.audit?.('auth.accept_invite_failed', { entityType: 'user', entityId: row.id, companyId: row.company_id ?? null, metadata: { reason: 'expired' } });
    throw badRequest('This invitation has expired. Please contact your administrator');
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users
     SET password_hash = ?, status = 'active', invitation_token = NULL, invitation_expires_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(hashPassword(password), now, row.id);

  const user = getUserContext(row.id);
  req.audit?.('auth.accept_invite', { entityType: 'user', entityId: user.id, companyId: user.companyId ?? null, metadata: { email: user.email } });

  const authToken = signToken({ sub: user.id });

  return ok(res, { token: authToken, user: serializeUser(user), tenant: buildTenantPayload(loadTenant(user)) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const db = getDb();
  const sets = [];
  const values = [];
  const fields = { name: 'name', phone: 'phone', jobTitle: 'job_title', avatarUrl: 'avatar_url' };

  for (const [input, column] of Object.entries(fields)) {
    if (req.body[input] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(req.body[input]);
    }
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(req.user.id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  req.audit?.('profile.update', { entityType: 'user', entityId: req.user.id });

  const user = getUserContext(req.user.id);
  return ok(res, { user: serializeUser(user) });
});

export const logout = asyncHandler(async (req, res) => {
  req.audit?.('auth.logout', { entityType: 'user', entityId: req.user.id });
  return ok(res, { loggedOut: true });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const db = getDb();

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw badRequest('Current password is incorrect');
  }

  db.prepare(
    `UPDATE users
     SET password_hash = ?, updated_at = ?, must_change_password = 0, temp_password_expires_at = NULL
     WHERE id = ?`
  ).run(hashPassword(newPassword), new Date().toISOString(), req.user.id);

  req.audit?.('auth.change_password', { entityType: 'user', entityId: req.user.id });
  return ok(res, { changed: true });
});

// Forced first-login password replacement. A Company Admin who was issued
// temporary credentials is locked into this flow until they set a new password;
// the temporary password is never accepted again once replaced.
export const setPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  const db = getDb();

  db.prepare(
    `UPDATE users
     SET password_hash = ?, updated_at = ?, must_change_password = 0, temp_password_expires_at = NULL
     WHERE id = ?`
  ).run(hashPassword(newPassword), new Date().toISOString(), req.user.id);

  req.audit?.('auth.set_password', { entityType: 'user', entityId: req.user.id });
  return ok(res, { changed: true });
});
