import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';

// eslint-disable-next-line no-unused-vars
export function notFoundHandler(req, res, _next) {
  // Use req.path (path only) rather than req.originalUrl so any query string
  // (which may carry sensitive values) is never echoed back to the client.
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` },
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Structured HTTP errors we raised ourselves.
  if (err instanceof HttpError) {
    const body = { success: false, error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  // Zod errors that escaped a validate() wrapper.
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  // Body-parser errors (malformed JSON).
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Malformed or oversized request body' },
    });
  }

  // Unknown errors: log server-side, never leak internals to the client.
  console.error('[unhandled]', err);
  const message = env.isProduction ? 'Internal server error' : err.message || 'Internal server error';
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message },
  });
}
