import { getDb } from '../db/connection.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getUserDataScope, buildLeadScopeWhere, buildCustomerScopeWhere } from '../services/access.js';

const GROUP_LIMIT = 8;

/**
 * Global search foundation. Searches entities that exist in Phase 1 and
 * returns empty buckets for modules that land in Phase 2+ (so the UI can be
 * wired end-to-end without fake results).
 */
export const search = asyncHandler(async (req, res) => {
  const db = getDb();
  const { q, scope } = req.query;
  const pattern = `%${q}%`;

  const results = { users: [], companies: [], teams: [], leads: [], customers: [], products: [] };

  if (scope === 'all' || scope === 'users') {
    if (req.user.isSuperAdmin) {
      results.users = db
        .prepare(
          `SELECT id, name, email, company_id, status FROM users
           WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT ?`
        )
        .all(pattern, pattern, GROUP_LIMIT);
    } else {
      results.users = db
        .prepare(
          `SELECT id, name, email, company_id, status FROM users
           WHERE company_id = ? AND (name LIKE ? OR email LIKE ?) ORDER BY name LIMIT ?`
        )
        .all(req.user.companyId, pattern, pattern, GROUP_LIMIT);
    }
  }

  if (scope === 'all' || scope === 'teams') {
    if (req.user.isSuperAdmin) {
      results.teams = db
        .prepare('SELECT id, name, company_id, is_active FROM teams WHERE name LIKE ? ORDER BY name LIMIT ?')
        .all(pattern, GROUP_LIMIT);
    } else {
      results.teams = db
        .prepare('SELECT id, name, company_id, is_active FROM teams WHERE company_id = ? AND name LIKE ? ORDER BY name LIMIT ?')
        .all(req.user.companyId, pattern, GROUP_LIMIT);
    }
  }

  if (scope === 'all' || scope === 'companies') {
    if (req.user.isSuperAdmin) {
      results.companies = db
        .prepare('SELECT id, name, slug, status FROM companies WHERE name LIKE ? OR slug LIKE ? ORDER BY name LIMIT ?')
        .all(pattern, pattern, GROUP_LIMIT);
    }
  }

  if (scope === 'all' || scope === 'leads') {
    const leadScope = getUserDataScope(req.user);
    const { where, params } = buildLeadScopeWhere(leadScope, 'l');
    const leadWhere = where
      ? `${where} AND l.deleted_at IS NULL AND (l.lead_no LIKE ? OR l.company_name LIKE ? OR l.contact_person LIKE ? OR l.email LIKE ? OR l.mobile LIKE ?)`
      : `WHERE l.deleted_at IS NULL AND (l.lead_no LIKE ? OR l.company_name LIKE ? OR l.contact_person LIKE ? OR l.email LIKE ? OR l.mobile LIKE ?)`;
    results.leads = db
      .prepare(
        `SELECT l.id, l.lead_no, l.company_name, l.contact_person, l.status, l.company_id, u.name AS assigned_name
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
         ${leadWhere} ORDER BY l.created_at DESC LIMIT ?`
      )
      .all(...params, pattern, pattern, pattern, pattern, pattern, GROUP_LIMIT);
  }

  if (scope === 'all' || scope === 'customers') {
    const customerScope = getUserDataScope(req.user);
    const { where, params } = buildCustomerScopeWhere(customerScope, 'c');
    const customerWhere = where
      ? `${where} AND c.deleted_at IS NULL AND (c.customer_no LIKE ? OR c.name LIKE ? OR c.contact_person LIKE ? OR c.email LIKE ? OR c.mobile LIKE ?)`
      : `WHERE c.deleted_at IS NULL AND (c.customer_no LIKE ? OR c.name LIKE ? OR c.contact_person LIKE ? OR c.email LIKE ? OR c.mobile LIKE ?)`;
    results.customers = db
      .prepare(
        `SELECT c.id, c.customer_no, c.name, c.contact_person, c.status, c.company_id, u.name AS assigned_name
         FROM customers c LEFT JOIN users u ON u.id = c.assigned_to
         ${customerWhere} ORDER BY c.created_at DESC LIMIT ?`
      )
      .all(...params, pattern, pattern, pattern, pattern, pattern, GROUP_LIMIT);
  }

  return ok(res, { query: q, results });
});
