import { getDb } from '../db/connection.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const health = asyncHandler(async (_req, res) => {
  return ok(res, {
    status: 'ok',
    service: 'sales-crm-api',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export const healthDb = asyncHandler(async (_req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT 1 AS ok').get();
  return ok(res, { database: row.ok === 1 ? 'ok' : 'error' });
});

export const healthReady = asyncHandler(async (_req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 AS ok').get();
    const ready = row.ok === 1;
    return res.status(ready ? 200 : 503).json({
      success: ready,
      data: { status: ready ? 'ready' : 'not_ready', database: ready ? 'ok' : 'error' },
    });
  } catch {
    return res.status(503).json({
      success: false,
      data: { status: 'not_ready', database: 'error' },
      error: { code: 'NOT_READY', message: 'Service not ready' },
    });
  }
});
