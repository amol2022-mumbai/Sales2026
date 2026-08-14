import { getDb } from '../db/connection.js';
import { paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const listAuditLogs = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize } = req.query;

  let where = '';
  const params = [];
  if (!req.user.isSuperAdmin) {
    where = 'WHERE a.company_id = ?';
    params.push(req.user.companyId);
  } else if (req.query.companyId) {
    where = 'WHERE a.company_id = ?';
    params.push(req.query.companyId);
  }

  if (req.query.action) {
    where += where ? ' AND a.action = ?' : 'WHERE a.action = ?';
    params.push(req.query.action);
  }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs a ${where}`).get(...params).c;
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize);

  return paginated(
    res,
    rows.map((a) => ({
      id: a.id,
      companyId: a.company_id,
      userId: a.user_id,
      userName: a.user_name || null,
      userEmail: a.user_email || null,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      ipAddress: a.ip_address,
      userAgent: a.user_agent,
      metadata: a.metadata ? JSON.parse(a.metadata) : null,
      createdAt: a.created_at,
    })),
    { page, pageSize, total }
  );
});
