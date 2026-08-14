import { getDb } from '../db/connection.js';

/**
 * Record an audit log entry.
 * @param {object} params
 * @param {number|null} params.companyId
 * @param {number|null} params.userId
 * @param {string} params.action e.g. 'auth.login', 'user.update'
 * @param {string} [params.entityType]
 * @param {string|number} [params.entityId]
 * @param {object} [params.metadata]
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 */
export function logAudit({ companyId = null, userId = null, action, entityType = null, entityId = null, metadata = null, ipAddress = null, userAgent = null }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, ip_address, user_agent, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    companyId,
    userId,
    action,
    entityType,
    entityId === null ? null : String(entityId),
    ipAddress,
    userAgent,
    metadata ? JSON.stringify(metadata) : null
  );
}

/**
 * Express middleware factory: attach an `audit` helper to the request that
 * records against the authenticated user and their company.
 */
export function auditMiddleware() {
  return function audit(req, _res, next) {
    req.audit = (action, opts = {}) => {
      logAudit({
        companyId: opts.companyId ?? req.user?.companyId ?? null,
        userId: opts.userId ?? req.user?.id ?? null,
        action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        metadata: opts.metadata,
        ipAddress: opts.ipAddress ?? req.ip,
        userAgent: opts.userAgent ?? req.headers['user-agent'],
      });
    };
    next();
  };
}
