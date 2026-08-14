/**
 * Wrap an async route handler so rejections flow to the central error handler.
 */
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
