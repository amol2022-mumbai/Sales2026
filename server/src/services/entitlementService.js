// ============================================================================
// Entitlement & usage enforcement service (Phase 19).
//
// Authoritative model:
//   Tenant/Company -> Subscription (license) -> Plan -> Entitlements (limits)
//     -> Usage -> Feature Access.
//
// A feature limit is resolved license-override > plan-default > unlimited.
// Usage for `monthly` features is metered in `usage_records` (resets each
// calendar month); usage for `absolute` features is derived from the tenant's
// real source data so it can never drift. Enforcement is server-side only and
// every function is scoped by an explicit `companyId` supplied by the caller
// (controllers derive it from the authenticated tenant context, never from
// client input for non-super-admins).
// ============================================================================

import { FEATURE_LIMITS, getFeatureLimitDefinition, isValidFeatureLimitKey } from '../config/limits.js';
import { resolveLicense } from './licenseService.js';
import { HttpError, badRequest } from '../lib/httpError.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentPeriodKey(period, ref = today()) {
  return period === 'monthly' ? ref.slice(0, 7) : 'lifetime';
}

function measureAbsoluteUsage(db, companyId, key) {
  if (key === 'leads') {
    return db.prepare('SELECT COUNT(*) AS c FROM leads WHERE company_id = ? AND deleted_at IS NULL').get(companyId).c;
  }
  if (key === 'customers') {
    return db.prepare('SELECT COUNT(*) AS c FROM customers WHERE company_id = ? AND deleted_at IS NULL').get(companyId).c;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Limit resolution (plan defaults + per-license overrides).
// ---------------------------------------------------------------------------

export function getPlanLimitMap(db, planId) {
  const rows = db.prepare('SELECT feature_key, limit_value FROM plan_limits WHERE plan_id = ?').all(planId);
  return new Map(rows.map((r) => [r.feature_key, r.limit_value]));
}

export function getLicenseLimitMap(db, licenseId) {
  const rows = db.prepare('SELECT feature_key, limit_value FROM license_limits WHERE license_id = ?').all(licenseId);
  return new Map(rows.map((r) => [r.feature_key, r.limit_value]));
}

function loadLicenseAndPlan(db, companyId) {
  const license = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId);
  const plan = license?.plan_id ? db.prepare('SELECT * FROM plans WHERE id = ?').get(license.plan_id) || null : null;
  return { license: license || null, plan };
}

/**
 * Effective limit for a feature. Returns `{ limit, source }` where `limit` is
 * the configured cap (or `null` for unlimited) and `source` is
 * 'license' | 'plan' | null.
 */
export function getFeatureLimit(db, companyId, key) {
  if (!isValidFeatureLimitKey(key)) return { limit: null, source: null };
  const { license, plan } = loadLicenseAndPlan(db, companyId);
  if (license) {
    const lmap = getLicenseLimitMap(db, license.id);
    if (lmap.has(key)) return { limit: lmap.get(key), source: 'license' };
  }
  if (plan) {
    const pmap = getPlanLimitMap(db, plan.id);
    if (pmap.has(key)) return { limit: pmap.get(key), source: 'plan' };
  }
  return { limit: null, source: null };
}

// ---------------------------------------------------------------------------
// Usage measurement.
// ---------------------------------------------------------------------------

export function getFeatureUsage(db, companyId, key, ref = today()) {
  const def = getFeatureLimitDefinition(key);
  if (!def) return 0;
  if (def.period === 'absolute') return measureAbsoluteUsage(db, companyId, key);
  const periodKey = currentPeriodKey(def.period, ref);
  const row = db
    .prepare('SELECT count FROM usage_records WHERE company_id = ? AND feature_key = ? AND period_key = ?')
    .get(companyId, key, periodKey);
  return row ? row.count : 0;
}

// ---------------------------------------------------------------------------
// Enforcement.
// ---------------------------------------------------------------------------

/**
 * Evaluate whether consuming `amount` more units would exceed the feature
 * limit. Returns `{ reached, limit, usage }` (never throws).
 */
export function isLimitReached(db, companyId, key, { amount = 1, ref = today() } = {}) {
  const { limit } = getFeatureLimit(db, companyId, key);
  const usage = getFeatureUsage(db, companyId, key, ref);
  if (limit == null || limit < 0) return { reached: false, limit: null, usage };
  return { reached: usage + amount > limit, limit, usage };
}

/**
 * Throw a 403 `LIMIT_REACHED` when consuming `amount` more would exceed the
 * feature limit. No-op when the feature is unknown or unlimited.
 */
export function assertUsageAllowed(db, companyId, key, { amount = 1, ref = today() } = {}) {
  const def = getFeatureLimitDefinition(key);
  if (!def) return;
  const { reached, limit, usage } = isLimitReached(db, companyId, key, { amount, ref });
  if (reached) {
    throw new HttpError(403, `${def.label} limit reached (${usage}/${limit}). Upgrade your plan to continue.`, {
      code: 'LIMIT_REACHED',
      details: { feature: key, limit, usage },
    });
  }
}

/**
 * Atomically record consumption for a metered (monthly) feature and enforce the
 * limit first (when `enforce` is true). Returns the new usage. For absolute
 * features usage is derived from source data, so nothing is recorded.
 */
export function consumeUsage(db, companyId, key, { amount = 1, enforce = true, ref = today() } = {}) {
  const def = getFeatureLimitDefinition(key);
  if (!def) return 0;
  if (def.period === 'absolute') return measureAbsoluteUsage(db, companyId, key);
  if (enforce) assertUsageAllowed(db, companyId, key, { amount, ref });

  const periodKey = currentPeriodKey(def.period, ref);
  db.prepare(
    `INSERT INTO usage_records (company_id, feature_key, period_key, count)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id, feature_key, period_key)
     DO UPDATE SET count = usage_records.count + excluded.count,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(companyId, key, periodKey, amount);
  const row = db
    .prepare('SELECT count FROM usage_records WHERE company_id = ? AND feature_key = ? AND period_key = ?')
    .get(companyId, key, periodKey);
  return row.count;
}

// ---------------------------------------------------------------------------
// Reporting (Super Admin + tenant self-service).
// ---------------------------------------------------------------------------

export function getUsageReport(db, companyId, ref = today()) {
  return FEATURE_LIMITS.map((f) => {
    const { limit } = getFeatureLimit(db, companyId, f.key);
    const capped = limit == null || limit < 0 ? null : limit;
    const usage = getFeatureUsage(db, companyId, f.key, ref);
    return {
      key: f.key,
      label: f.label,
      period: f.period,
      limit: capped,
      usage,
      remaining: capped == null ? null : Math.max(0, capped - usage),
      utilizationPct: capped == null || capped <= 0 ? null : Math.round((usage / capped) * 100),
    };
  });
}

/**
 * Effective entitlements for a tenant: assigned plan, resolved license status,
 * enabled modules, and the unified feature-limit view (legacy user/storage
 * columns plus the generalized feature limits) alongside current usage.
 */
export function getEffectiveEntitlements(db, companyId) {
  const resolved = resolveLicense(db, companyId);
  const limitValue = (key) => {
    const { limit } = getFeatureLimit(db, companyId, key);
    return limit == null ? null : limit;
  };
  return {
    companyId,
    plan: resolved.plan ? { id: resolved.plan.id, key: resolved.plan.key, name: resolved.plan.name } : null,
    licenseStatus: resolved.status,
    moduleKeys: resolved.moduleKeys,
    limits: {
      users: resolved.userLimit,
      storageMb: resolved.storageLimitMb,
      leads: limitValue('leads'),
      customers: limitValue('customers'),
      aiRequests: limitValue('ai_requests'),
      exports: limitValue('exports'),
    },
    usage: getUsageReport(db, companyId),
  };
}

// ---------------------------------------------------------------------------
// Super Admin persistence helpers (validated).
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a `limits` record (`{ featureKey: number }`). Returns
 * a Map (or `null` for undefined/null input). Throws 400 for unknown feature
 * keys or non-integer / < -1 values. Callers should validate BEFORE writing
 * anything so invalid input never leaves a partial write.
 */
export function validateFeatureLimits(input, label = 'limits') {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw badRequest(`${label} must be an object`);
  const out = new Map();
  for (const [key, value] of Object.entries(input)) {
    if (!isValidFeatureLimitKey(key)) throw badRequest(`Unknown feature limit key: ${key}`);
    const n = Number(value);
    if (!Number.isInteger(n) || n < -1) throw badRequest(`Invalid limit value for ${key}: ${value}`);
    out.set(key, n);
  }
  return out;
}

export function applyPlanLimits(db, planId, limits) {
  const map = validateFeatureLimits(limits);
  if (map == null) return;
  db.prepare('DELETE FROM plan_limits WHERE plan_id = ?').run(planId);
  const insert = db.prepare(
    `INSERT INTO plan_limits (plan_id, feature_key, limit_value) VALUES (?, ?, ?)
     ON CONFLICT(plan_id, feature_key) DO UPDATE SET limit_value = excluded.limit_value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  );
  for (const [key, value] of map) insert.run(planId, key, value);
}

export function applyLicenseLimits(db, licenseId, limits) {
  const map = validateFeatureLimits(limits);
  if (map == null) return;
  db.prepare('DELETE FROM license_limits WHERE license_id = ?').run(licenseId);
  const insert = db.prepare(
    `INSERT INTO license_limits (license_id, feature_key, limit_value) VALUES (?, ?, ?)
     ON CONFLICT(license_id, feature_key) DO UPDATE SET limit_value = excluded.limit_value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  );
  for (const [key, value] of map) insert.run(licenseId, key, value);
}
