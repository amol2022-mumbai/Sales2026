import { forbidden } from '../lib/httpError.js';
import { hasPermission } from '../services/userService.js';

/**
 * Role-based access control middleware.
 * @param {string|string[]} permissionKey single permission or list (any-of).
 */
export function authorize(permissionKey) {
  const required = Array.isArray(permissionKey) ? permissionKey : [permissionKey];

  return function rbac(req, _res, next) {
    if (!req.user) return next(forbidden());
    if (required.some((key) => hasPermission(req.user, key))) return next();
    return next(forbidden());
  };
}
