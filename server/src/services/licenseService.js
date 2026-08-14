// ============================================================================
// License & tenant service. A "client" is a company (tenant) that may have a
// license. When a company has NO license row the product behaves as fully
// enabled (self-hosted / single-tenant / legacy behaviour), so existing
// deployments keep working unchanged. Once a Super Admin provisions a license,
// its lifecycle (status, expiry, user limit, enabled modules) is enforced.
// ============================================================================

import { getDb } from '../db/connection.js';
import { ALL_MODULE_KEYS, CORE_MODULES, isValidModuleKey, isCoreModule } from '../config/modules.js';
import { HttpError } from '../lib/httpError.js';

export const LICENSE_STATUSES = ['active', 'expired', 'suspended', 'trial'];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseModules(value) {
  if (value == null) return null; // null = inherit / all
  try {
    const arr = JSON.parse(value);
    if (!Array.isArray(arr)) return null;
    return arr.filter((k) => typeof k === 'string');
  } catch {
    return null;
  }
}

function serializeModules(set) {
  return set ? [...set].filter((k) => !isCoreModule(k)).sort() : null;
}

/**
 * Resolve the effective license state for a company. Auto-transitions an
 * active/trial license whose expiry has passed to `expired`.
 * @returns {{ license: object|null, plan: object|null, status: string, expiresAt: string|null, userLimit: number, moduleKeys: string[]|null }}
 */
export function resolveLicense(db, companyId) {
  const license = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId);
  if (!license) {
    return { license: null, plan: null, status: 'active', expiresAt: null, userLimit: -1, moduleKeys: null };
  }

  let status = license.status;
  const plan = license.plan_id ? db.prepare('SELECT * FROM plans WHERE id = ?').get(license.plan_id) || null : null;

  // Auto-expiry for active/trial licenses.
  if ((status === 'active' || status === 'trial') && license.expires_at && license.expires_at < today()) {
    status = 'expired';
    db.prepare("UPDATE licenses SET status = 'expired', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(license.id);
  }

  const userLimit = license.user_limit != null ? license.user_limit : plan?.user_limit != null ? plan.user_limit : -1;
  const moduleKeys = license.modules != null ? parseModules(license.modules) : plan?.modules != null ? parseModules(plan.modules) : null;

  return {
    license,
    plan,
    status,
    expiresAt: license.expires_at,
    startsAt: license.starts_at,
    userLimit,
    moduleKeys: moduleKeys ? moduleKeys.filter(isValidModuleKey) : null,
  };
}

/**
 * Enabled module set for a company. `null` input resolves to "all modules".
 * Core modules are always present.
 */
export function getEnabledModules(db, companyId) {
  const { moduleKeys } = resolveLicense(db, companyId);
  if (moduleKeys == null) return new Set(ALL_MODULE_KEYS);
  return new Set([...moduleKeys, ...CORE_MODULES]);
}

export function isModuleEnabled(db, companyId, key) {
  if (isCoreModule(key)) return true;
  return getEnabledModules(db, companyId).has(key);
}

export function isLicenseActive(status) {
  return status === 'active' || status === 'trial';
}

/**
 * Attach tenant context (company, license, enabled modules) to a request.
 * Returns null for super admins / users without a company. Throws a 403 when
 * the client's license is suspended or expired (super admins bypass).
 * @param {object} user authenticated user context
 * @param {string|null} tenantId optional override (super admin impersonation)
 */
export function loadTenant(user, tenantId = null) {
  const db = getDb();
  const companyId = tenantId ?? user.companyId;
  if (!companyId) return null;

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) return null;

  const resolved = resolveLicense(db, company.id);
  return { company, ...resolved };
}

/**
 * Throw if the client license is not active (used as a request guard).
 */
export function assertLicenseActive(tenant) {
  if (!tenant) return;
  if (tenant.company?.status === 'suspended') {
    throw new HttpError(403, 'This account is suspended. Please contact support.', { code: 'TENANT_SUSPENDED' });
  }
  if (tenant.company?.status === 'inactive') {
    throw new HttpError(403, 'This account has been deactivated. Please contact support.', { code: 'TENANT_INACTIVE' });
  }
  if (tenant.status === 'suspended') {
    throw new HttpError(403, 'This account is suspended. Please contact support.', { code: 'LICENSE_SUSPENDED' });
  }
  if (tenant.status === 'expired') {
    throw new HttpError(403, 'This account has expired. Please renew your subscription.', { code: 'LICENSE_EXPIRED' });
  }
}

export function assertModuleEnabled(tenant, key) {
  if (isCoreModule(key)) return;
  if (!tenant) return; // no tenant (self-hosted) -> all modules available
  if (!tenant.moduleKeys) return; // no explicit modules -> all available
  if (tenant.moduleKeys.includes(key)) return;
  throw new HttpError(403, 'This module is not enabled for your plan.', { code: 'MODULE_DISABLED' });
}

export function getUserCount(db, companyId) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND status != 'inactive'").get(companyId);
  return row.c;
}

export function getUserLimit(tenant) {
  return tenant?.userLimit ?? -1;
}

export function assertUserLimit(tenant, companyId) {
  if (!tenant || tenant.userLimit < 0) return;
  const db = getDb();
  if (getUserCount(db, companyId) >= tenant.userLimit) {
    throw new HttpError(403, `User limit reached (${tenant.userLimit}). Upgrade your plan to add more users.`, {
      code: 'USER_LIMIT_REACHED',
    });
  }
}

/**
 * Build the JSON payload exposed to clients (login / me / config) describing
 * the tenant's white-label branding and license state. Never includes internal
 * ids beyond companyId or any secrets.
 */
export function buildTenantPayload(tenant) {
  if (!tenant) return null;
  const { company, plan, status, expiresAt, startsAt, userLimit, moduleKeys } = tenant;
  return {
    companyId: company.id,
    name: company.name,
    slug: company.slug,
    domain: company.domain || null,
    logoUrl: company.logo_url || null,
    faviconUrl: company.favicon_url || null,
    brandColor: company.brand_color || null,
    email: company.email || null,
    phone: company.phone || null,
    website: company.website || null,
    address: company.address || null,
    city: company.city || null,
    state: company.state || null,
    country: company.country || null,
    postalCode: company.postal_code || null,
    currency: company.currency || 'USD',
    timezone: company.timezone || 'UTC',
    license: {
      status,
      planKey: plan?.key || null,
      planName: plan?.name || null,
      startsAt: startsAt || null,
      expiresAt: expiresAt || null,
      userLimit,
      modules: moduleKeys ? [...moduleKeys, ...CORE_MODULES].sort() : null,
    },
  };
}

export function serializeModulesArray(set) {
  return serializeModules(set);
}
