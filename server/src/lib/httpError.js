/**
 * Application error with HTTP semantics. Thrown from services/controllers and
 * translated to a structured JSON response by the central error handler.
 */
export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = options.code || 'HTTP_ERROR';
    this.details = options.details || undefined;
    this.expose = options.expose !== false;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, { code: 'BAD_REQUEST', details });
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, message, { code: 'UNAUTHORIZED' });
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, message, { code: 'FORBIDDEN' });
export const notFound = (message = 'Resource not found') =>
  new HttpError(404, message, { code: 'NOT_FOUND' });
export const conflict = (message) => new HttpError(409, message, { code: 'CONFLICT' });
export const tooManyRequests = (message = 'Too many requests') =>
  new HttpError(429, message, { code: 'RATE_LIMITED' });
export const internal = (message = 'Internal server error') =>
  new HttpError(500, message, { code: 'INTERNAL_ERROR', expose: false });
