/**
 * Consistent JSON response envelope.
 *   success: true  -> { success: true, data: ..., meta?: ... }
 *   success: false -> { success: false, error: { code, message, details? } }
 */
export function ok(res, data, meta) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(200).json(body);
}

export function created(res, data) {
  return res.status(201).json({ success: true, data });
}

export function noContent(res) {
  return res.status(204).end();
}

export function paginated(res, data, { page, pageSize, total }) {
  return res.status(200).json({
    success: true,
    data,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 0 },
  });
}
