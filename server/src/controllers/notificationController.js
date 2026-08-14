import { getDb } from '../db/connection.js';
import { notFound, forbidden } from '../lib/httpError.js';
import { ok, noContent } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';

function notificationToJson(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    isRead: Boolean(n.is_read),
    createdAt: n.created_at,
  };
}

export const listNotifications = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize } = req.query;
  const unreadOnly = req.query.unread === 'true';

  let where = 'WHERE user_id = ?';
  const params = [req.user.id];
  if (unreadOnly) where += ' AND is_read = 0';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM notifications ${where}`).get(...params).c;
  const rows = db
    .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  const unreadCount = db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id).c;

  return ok(res, { items: rows.map(notificationToJson), unreadCount, page, pageSize, total });
});

export const markRead = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id, user_id FROM notifications WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('Notification not found');
  if (row.user_id !== req.user.id) throw forbidden('You cannot access this notification');

  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(row.id);
  return ok(res, { id: row.id, isRead: true });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  return noContent(res);
});
