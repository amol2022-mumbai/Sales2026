import { verifyToken } from '../lib/jwt.js';
import { unauthorized, forbidden } from '../lib/httpError.js';
import { HttpError } from '../lib/httpError.js';
import { getUserContext } from '../services/userService.js';
import { loadTenant, assertLicenseActive, assertModuleEnabled, assertExportEnabled, assertApiEnabled } from '../services/licenseService.js';

/**
 * Authenticate the request using a Bearer JWT and attach the user context.
 * Super admins may access any company; other roles are scoped to theirs.
 * Also attaches `req.tenant` (company + license + enabled modules) and enforces
 * an active license for non-super-admin requests.
 */
export function authenticate(req, _res, next) {
  authenticateRequest(req, next, { assertLicense: true });
}

/**
 * Like `authenticate` but does NOT reject tenants whose *license* is suspended,
 * expired or cancelled. Used by the billing surface so a tenant can renew,
 * reactivate or otherwise restore their subscription. Company-level status
 * (suspended/inactive) is still enforced.
 */
export function authenticateAllowInactive(req, _res, next) {
  authenticateRequest(req, next, { assertLicense: false });
}

function authenticateRequest(req, next, { assertLicense }) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw unauthorized();
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw unauthorized('Invalid or expired token');
    }

    const user = getUserContext(payload.sub);
    if (!user) {
      throw unauthorized('Account no longer exists');
    }
    if (user.status !== 'active') {
      throw unauthorized('Account is not active');
    }

    req.user = user;

    const tenant = loadTenant(user);
    if (!user.isSuperAdmin) {
      if (tenant?.company?.status === 'suspended') {
        throw new HttpError(403, 'This account is suspended. Please contact support.', { code: 'TENANT_SUSPENDED' });
      }
      if (tenant?.company?.status === 'inactive') {
        throw new HttpError(403, 'This account has been deactivated. Please contact support.', { code: 'TENANT_INACTIVE' });
      }
      if (assertLicense) {
        assertLicenseActive(tenant);
      }
    }
    req.tenant = tenant;

    // Forced password replacement: a non-super-admin account issued temporary
    // credentials is blocked from every surface except the minimal auth
    // endpoints needed to inspect their session, log out, or replace the
    // temporary password. Tenant/RBAC enforcement above still applies.
    if (!user.isSuperAdmin && user.mustChangePassword) {
      const path = `${req.baseUrl || ''}${req.path || ''}`;
      if (!PASSWORD_CHANGE_ALLOWED.has(path)) {
        throw new HttpError(403, 'You must set a new password before continuing.', { code: 'PASSWORD_CHANGE_REQUIRED' });
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

const PASSWORD_CHANGE_ALLOWED = new Set([
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/change-password',
  '/api/auth/set-password',
]);

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  return next();
}

/**
 * Super admin only guard (for cross-company / system administration routes).
 */
export function requireSuperAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!req.user.isSuperAdmin) return next(forbidden('Super admin access required'));
  return next();
}

/**
 * Guard that the current client has the given module enabled. No-op for super
 * admins and for tenants without an explicit module restriction.
 */
export function requireModule(moduleKey) {
  return function moduleGuard(req, _res, next) {
    if (!req.user) return next(unauthorized());
    if (req.user.isSuperAdmin) return next();
    try {
      assertModuleEnabled(req.tenant, moduleKey);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Guard that the client's plan/license permits data export. No-op for super
 * admins and tenants without an explicit entitlement (self-hosted behaviour).
 */
export function requireExport(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.isSuperAdmin) return next();
  try {
    assertExportEnabled(req.tenant);
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Guard that the client's plan/license permits API & integration access
 * (external service calls such as the AI assistant provider). No-op for super
 * admins and tenants without an explicit entitlement.
 */
export function requireApiAccess(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.isSuperAdmin) return next();
  try {
    assertApiEnabled(req.tenant);
    return next();
  } catch (err) {
    return next(err);
  }
}
