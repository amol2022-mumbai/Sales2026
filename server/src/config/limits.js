// ============================================================================
// Feature-limit catalog. Defines the named, limitable features of the platform
// so a Super Admin can configure plan-level defaults and per-tenant overrides.
//
// `period` controls how a feature's usage is measured:
//   - `absolute`: a hard cap on the tenant's current total (derived from real
//     source tables, e.g. lead/customer counts). No periodic reset.
//   - `monthly`: a metered allowance that resets each calendar month; tracked
//     in `usage_records` keyed by `YYYY-MM`.
//
// `users` and `storage` continue to be carried on the legacy `user_limit` /
// `storage_limit_mb` columns (backward compatible); they are surfaced in the
// effective-entitlements view but are not part of this catalog.
// ============================================================================

export const FEATURE_LIMITS = [
  { key: 'leads', label: 'Leads', period: 'absolute' },
  { key: 'customers', label: 'Customers', period: 'absolute' },
  { key: 'ai_requests', label: 'AI Requests', period: 'monthly' },
  { key: 'exports', label: 'Exports', period: 'monthly' },
];

export const FEATURE_PERIODS = ['monthly', 'absolute'];

const byKey = new Map(FEATURE_LIMITS.map((f) => [f.key, f]));

export function getFeatureLimitDefinition(key) {
  return byKey.get(key) || null;
}

export function isValidFeatureLimitKey(key) {
  return byKey.has(key);
}
