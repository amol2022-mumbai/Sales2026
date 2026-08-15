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

// Stored (persisted) license lifecycle states. `expiring` is a derived state
// reported alongside the stored one when an active/trial license is close to
// its expiry date. `past_due` is entered when a subscription payment fails and
// carries a grace period before it is resolved as `suspended`.
export const LICENSE_STATUSES = ['active', 'trial', 'past_due', 'expired', 'suspended', 'cancelled'];

// The full tenant lifecycle as observed across the platform. `pending` (no
// license provisioned yet) and `deactivated` (company status `inactive`) are
// company-level states; the rest mirror the resolved license status.
export const TENANT_LIFECYCLE_STATUSES = [
  'pending',
  'trial',
  'active',
  'expiring',
  'past_due',
  'expired',
  'suspended',
  'cancelled',
  'deactivated',
];

// Number of days before expiry at which an active/trial license is reported as
// `expiring`.
export const EXPIRING_SOON_DAYS = 30;

// Number of days a license may remain `past_due` before it is resolved as
// `suspended` (grace period). During this window access is still permitted so
// a transient payment failure does not immediately lock a tenant out.
export const PAST_DUE_GRACE_DAYS = 14;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  if (!dateStr) return null;
  // Accept both date-only (YYYY-MM-DD) and full ISO timestamps.
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseBool(value) {
  if (value == null) return null;
  return value ? true : false;
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
 * Resolve the effective license state from an already-loaded license and plan
 * row (pure — no database access). A `null` license means "fully enabled"
 * (self-hosted / single-tenant / legacy). An active/trial license whose expiry
 * has passed resolves to `expired`; one within EXPIRING_SOON_DAYS of expiring
 * resolves to the derived `expiring` state. `ref` is the reference date string
 * (YYYY-MM-DD) to evaluate expiry against.
 * @returns {{ license: object|null, plan: object|null, status: string, expiresAt: string|null, startsAt: string|null, userLimit: number, moduleKeys: string[]|null, storageLimitMb: number, exportEnabled: boolean, apiEnabled: boolean }}
 */
export function resolveLicenseState(license, plan, ref = today()) {
  if (!license) {
    return {
      license: null,
      plan: null,
      status: 'active',
      expiresAt: null,
      startsAt: null,
      pastDueAt: null,
      userLimit: -1,
      moduleKeys: null,
      storageLimitMb: -1,
      exportEnabled: true,
      apiEnabled: true,
    };
  }

  let status = license.status;

  // Auto-expiry for active/trial licenses.
  if ((status === 'active' || status === 'trial') && license.expires_at && license.expires_at < ref) {
    status = 'expired';
  }

  // Derived `expiring` state for active/trial licenses nearing expiry.
  if (status === 'active' || status === 'trial') {
    if (license.expires_at) {
      const horizon = addDays(ref, EXPIRING_SOON_DAYS);
      if (license.expires_at <= horizon && license.expires_at >= ref) {
        status = 'expiring';
      }
    }
  }

  // Past-due grace period: a license that stays `past_due` beyond its grace
  // window is resolved as `suspended` (access blocked).
  if (status === 'past_due' && license.past_due_at) {
    const deadline = addDays(license.past_due_at, PAST_DUE_GRACE_DAYS);
    if (deadline && deadline < ref) {
      status = 'suspended';
    }
  }

  const userLimit = license.user_limit != null ? license.user_limit : plan?.user_limit != null ? plan.user_limit : -1;
  const moduleKeys = license.modules != null ? parseModules(license.modules) : plan?.modules != null ? parseModules(plan.modules) : null;

  const storageLimitMb =
    license.storage_limit_mb != null
      ? license.storage_limit_mb
      : plan?.storage_limit_mb != null
        ? plan.storage_limit_mb
        : -1;
  const exportEnabled = parseBool(license.export_enabled) ?? (plan ? Boolean(plan.export_enabled) : true);
  const apiEnabled = parseBool(license.api_enabled) ?? (plan ? Boolean(plan.api_enabled) : true);

  return {
    license,
    plan,
    status,
    expiresAt: license.expires_at,
    startsAt: license.starts_at,
    pastDueAt: license.past_due_at ?? null,
    userLimit,
    moduleKeys: moduleKeys ? moduleKeys.filter(isValidModuleKey) : null,
    storageLimitMb,
    exportEnabled,
    apiEnabled,
  };
}

/**
 * Resolve the effective license state for a company. Loads the license (and its
 * plan) then delegates to {@link resolveLicenseState}. Persists the derived
 * `expired` transition for active/trial licenses whose expiry has passed so the
 * stored state stays consistent.
 * @returns {{ license: object|null, plan: object|null, status: string, expiresAt: string|null, startsAt: string|null, userLimit: number, moduleKeys: string[]|null, storageLimitMb: number, exportEnabled: boolean, apiEnabled: boolean }}
 */
export function resolveLicense(db, companyId) {
  const license = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId);
  if (!license) return resolveLicenseState(null, null);

  const plan = license.plan_id ? db.prepare('SELECT * FROM plans WHERE id = ?').get(license.plan_id) || null : null;

  // Persist the auto-expiry transition (side effect kept for stored consistency).
  if ((license.status === 'active' || license.status === 'trial') && license.expires_at && license.expires_at < today()) {
    license.status = 'expired';
    db.prepare("UPDATE licenses SET status = 'expired', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(license.id);
  }

  // Persist the past-due grace transition (past_due -> suspended) for stored
  // consistency, mirroring the expiry handling above.
  if (license.status === 'past_due' && license.past_due_at) {
    const deadline = addDays(license.past_due_at, PAST_DUE_GRACE_DAYS);
    if (deadline && deadline < today()) {
      license.status = 'suspended';
      db.prepare("UPDATE licenses SET status = 'suspended', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(license.id);
    }
  }

  return resolveLicenseState(license, plan);
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
  return status === 'active' || status === 'trial' || status === 'expiring';
}

export function isExportEnabled(tenant) {
  if (!tenant) return true; // no tenant (self-hosted) -> enabled
  return tenant.exportEnabled !== false;
}

export function isApiEnabled(tenant) {
  if (!tenant) return true; // no tenant (self-hosted) -> enabled
  return tenant.apiEnabled !== false;
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
 * Compute a tenant's single lifecycle state by combining its company status
 * with its resolved license status. Precedence:
 *   suspended/deactivated (company level) → pending (no license) → license state.
 * @returns {{ company, license, plan, lifecycle, status, ...resolveLicense } | null}
 */
export function resolveTenantLifecycle(db, companyId) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) return null;

  const resolved = resolveLicense(db, companyId);

  let lifecycle;
  if (company.status === 'suspended') lifecycle = 'suspended';
  else if (company.status === 'inactive') lifecycle = 'deactivated';
  else if (!resolved.license) lifecycle = 'pending';
  else lifecycle = resolved.status;

  return { company, ...resolved, lifecycle };
}

/**
 * Derive a lifecycle state from an already-resolved tenant (used where the
 * company + resolved license are already in hand to avoid an extra query).
 */
export function lifecycleFromTenant(company, resolved) {
  if (company.status === 'suspended') return 'suspended';
  if (company.status === 'inactive') return 'deactivated';
  if (!resolved.license) return 'pending';
  return resolved.status;
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
  if (tenant.status === 'cancelled') {
    throw new HttpError(403, 'This subscription has been cancelled. Please contact support.', { code: 'LICENSE_CANCELLED' });
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

export function assertExportEnabled(tenant) {
  if (isExportEnabled(tenant)) return;
  throw new HttpError(403, 'Data export is not enabled for your plan.', { code: 'EXPORT_DISABLED' });
}

export function assertApiEnabled(tenant) {
  if (isApiEnabled(tenant)) return;
  throw new HttpError(403, 'API and integration access is not enabled for your plan.', { code: 'API_ACCESS_DISABLED' });
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
  const { company, plan, status, expiresAt, startsAt, pastDueAt, userLimit, moduleKeys, storageLimitMb, exportEnabled, apiEnabled } = tenant;
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
    lifecycleStatus: lifecycleFromTenant(company, tenant),
    onboardedAt: company.onboarded_at || null,
    activatedAt: company.activated_at || null,
    license: {
      status,
      planKey: plan?.key || null,
      planName: plan?.name || null,
      startsAt: startsAt || null,
      expiresAt: expiresAt || null,
      pastDueAt: pastDueAt || null,
      userLimit,
      modules: moduleKeys ? [...moduleKeys, ...CORE_MODULES].sort() : null,
      storageLimitMb,
      exportEnabled: exportEnabled !== false,
      apiEnabled: apiEnabled !== false,
    },
  };
}

export function serializeModulesArray(set) {
  return serializeModules(set);
}
