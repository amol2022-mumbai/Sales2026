import { getDb } from '../db/connection.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { env } from '../config/env.js';
import { buildTenantPayload, resolveLicense } from '../services/licenseService.js';

/**
 * Public white-label configuration endpoint (no auth). Resolves the tenant by:
 *   1. an explicit `?companyId=` query param (super admin preview),
 *   2. matching the request `Host` header against `companies.domain`,
 *   3. the first active company (single-client deployments),
 *   4. platform-level env defaults when no company exists.
 * Returns branding + license + module catalog so the SPA can brand itself
 * before the user logs in. No secrets are ever included.
 */
export const publicConfig = asyncHandler(async (req, res) => {
  const db = getDb();

  let company = null;

  if (req.query.companyId) {
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
