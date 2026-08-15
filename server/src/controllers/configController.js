import { getDb } from '../db/connection.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { env } from '../config/env.js';
import { buildTenantPayload, resolveLicense } from '../services/licenseService.js';
import { verifyToken } from '../lib/jwt.js';
import { getUserContext } from '../services/userService.js';

/**
 * Returns true only when the request carries a valid Bearer token for a Super
 * Admin. Used to gate the `?companyId=` preview param so that anonymous
 * visitors cannot enumerate arbitrary tenants' branding/license details.
 */
function isSuperAdminRequest(req) {
  try {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return false;
    const payload = verifyToken(token);
    const user = getUserContext(payload.sub);
    return Boolean(user?.isSuperAdmin);
  } catch {
    return false;
  }
}

/**
 * Public white-label configuration endpoint (no auth). Resolves the tenant by:
 *   1. an explicit `?companyId=` query param (super admin preview only),
 *   2. matching the request `Host` header against `companies.domain`,
 *   3. the first active company (single-client deployments),
 *   4. platform-level env defaults when no company exists.
 * Returns branding + license + module catalog so the SPA can brand itself
 * before the user logs in. No secrets are ever included.
 */
export const publicConfig = asyncHandler(async (req, res) => {
  const db = getDb();

  let company = null;

  if (req.query.companyId && isSuperAdminRequest(req)) {
    company = db.prepare('SELECT * FROM companies WHERE id = ?').get(Number(req.query.companyId)) || null;
  }

  if (!company) {
    const host = (req.get('host') || '').replace(/:\d+$/, '');
    if (host) {
      company = db.prepare('SELECT * FROM companies WHERE domain = ?').get(host) || null;
    }
  }

  if (!company) {
    company = db.prepare("SELECT * FROM companies WHERE status = 'active' ORDER BY id LIMIT 1").get() || null;
  }

  let tenant = null;
  if (company) {
    const resolved = resolveLicense(db, company.id);
    tenant = { company, ...resolved };
  }

  const payload = tenant ? buildTenantPayload(tenant) : null;

  return ok(res, {
    appName: env.appName,
    name: payload?.name ?? env.appName,
    domain: payload?.domain ?? null,
    logoUrl: payload?.logoUrl ?? (env.appLogoUrl || null),
    faviconUrl: payload?.faviconUrl ?? (env.appFaviconUrl || null),
    brandColor: payload?.brandColor ?? env.appBrandColor,
    company: payload,
  });
});
