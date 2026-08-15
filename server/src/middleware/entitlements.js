// ============================================================================
// Feature-limit middleware (Phase 19). Reusable route guards that enforce the
// tenant's configured feature limits server-side. Consistent with the existing
// requireModule / requireExport / requireApiAccess guards: no-op for super
// admins and for tenants without a configured limit.
//
//   requireFeatureLimit(key)  — verify the tenant is still under a limit
//                              without consuming (absolute features derive
//                              usage from source data).
//   consumeFeature(key)       — enforce + atomically record consumption for a
//                              metered (monthly) feature.
//
// The companyId is always derived from the authenticated tenant context
// (req.tenant) and never from client input, preserving tenant isolation.
// ============================================================================

import { getDb } from '../db/connection.js';
import { unauthorized } from '../lib/httpError.js';
import { assertUsageAllowed, consumeUsage } from '../services/entitlementService.js';

function companyIdFor(req) {
  return req.tenant?.company?.id ?? req.user?.companyId ?? null;
}

export function requireFeatureLimit(featureKey) {
  return function featureLimitGuard(req, _res, next) {
    if (!req.user) return next(unauthorized());
    if (req.user.isSuperAdmin) return next();
    const companyId = companyIdFor(req);
    if (!companyId) return next();
    try {
      assertUsageAllowed(getDb(), companyId, featureKey);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function consumeFeature(featureKey, { amount = 1 } = {}) {
  return function featureConsumeGuard(req, _res, next) {
    if (!req.user) return next(unauthorized());
    if (req.user.isSuperAdmin) return next();
    const companyId = companyIdFor(req);
    if (!companyId) return next();
    try {
      consumeUsage(getDb(), companyId, featureKey, { amount });
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
