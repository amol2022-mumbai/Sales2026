import { badRequest } from '../lib/httpError.js';

/**
 * Validate `req[source]` against a zod schema and replace it with the parsed
 * result. Throws a 400 with structured details on failure.
 * @param {import('zod').ZodSchema} schema
 * @param {'body'|'query'|'params'} source
 */
export function validate(schema, source = 'body') {
  return function validator(req, _res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(badRequest('Validation failed', details));
    }
    req[source] = result.data;
    return next();
  };
}
