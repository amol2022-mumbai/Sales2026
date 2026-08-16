import { getDb } from '../db/connection.js';

/**
 * Data-access scope derived from a user's role. This drives both list
 * filtering (company / team / self) and record-level authorization checks, so
 * security is enforced in the backend rather than only in the UI.
 *
 * Hierarchy:
 *   Super Admin    -> all data
 *   Business Owner -> company data
 *   Sales Manager  -> assigned teams
 *   Team Leader    -> assigned team
 *   Sales Exec     -> own records
 *   Viewer / others-> company data (read-only via RBAC)
 */
export function getUserDataScope(user) {
  if (!user) return { type: 'none' };
  if (user.isSuperAdmin) return { type: 'all' };

  const db = getDb();
  switch (user.roleKey) {
    case 'sales_manager': {
      const teams = db
        .prepare('SELECT id FROM teams WHERE manager_id = ? AND company_id = ?')
        .all(user.id, user.companyId)
        .map((t) => t.id);
      return { type: 'teams', companyId: user.companyId, teamIds: teams, selfId: user.id };
    }
    case 'team_leader': {
      const led = db
        .prepare('SELECT id FROM teams WHERE lead_id = ? AND company_id = ?')
        .all(user.id, user.companyId)
        .map((t) => t.id);
      const teamIds = new Set(led);
      if (user.teamId) teamIds.add(user.teamId);
      return { type: 'team', companyId: user.companyId, teamIds: [...teamIds], selfId: user.id };
    }
    case 'sales_executive':
      return { type: 'self', selfId: user.id, companyId: user.companyId };
    default:
      // business_owner, accountant, viewer -> whole company.
      return { type: 'company', companyId: user.companyId };
  }
}

/**
 * SQL fragment that excludes platform Super Admin users. Super admins are
 * global platform accounts and must never surface in a tenant's user list,
 * even if their `company_id` was (incorrectly) set to a tenant.
 */
function excludeSuperAdmins(alias) {
  return `${alias}.role_id NOT IN (SELECT id FROM roles WHERE is_super_admin = 1)`;
}

/**
 * True when `target` is a platform Super Admin. `target.role_id` is present on
 * the full user rows passed by the user-management controllers; assignment
 * helpers pass lighter rows (without role_id) and are therefore unaffected.
 */
function isSuperAdminUser(target) {
  if (!target || target.role_id == null) return false;
  const role = getDb().prepare('SELECT is_super_admin FROM roles WHERE id = ?').get(target.role_id);
  return Boolean(role?.is_super_admin);
}

/**
 * Build a WHERE fragment + params that scopes a query over the `users` table
 * (aliased) to the data the acting user is allowed to see. Super admins are
 * always excluded from non-'all' scopes.
 */
export function buildUserScopeWhere(scope, alias = 'u') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ? AND ${excludeSuperAdmins(alias)}`, params: [scope.companyId] };
    case 'teams': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.id = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.id = ?) AND ${excludeSuperAdmins(alias)}`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.id = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.id = ?) AND ${excludeSuperAdmins(alias)}`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE ${alias}.id = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

function selfId(scope) {
  return scope.selfId;
}

/**
 * Record-level check: can the acting user view a given user record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target user row (needs id, company_id, team_id)
 */
export function canViewUser(scope, target) {
  if (scope.type !== 'all' && isSuperAdminUser(target)) return false;
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.id === selfId(scope);
    case 'self':
      return target.id === scope.selfId;
    default:
      return false;
  }
}

/**
 * Record-level check: can the acting user modify a given user record
 * (edit / deactivate / reset password)?
 */
export function canManageUser(scope, target) {
  if (scope.type !== 'all' && isSuperAdminUser(target)) return false;
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.id === selfId(scope);
    case 'self':
      return target.id === scope.selfId;
    default:
      return false;
  }
}

/**
 * Can the acting user manage a team record?
 * @param {object} scope
 * @param {object} team team row (needs id, company_id)
 */
export function canManageTeam(scope, team) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return team.company_id === scope.companyId;
    case 'teams':
      return team.company_id === scope.companyId && scope.teamIds.includes(team.id);
    case 'team':
      return scope.teamIds.includes(team.id);
    default:
      return false;
  }
}

export function canViewTeam(scope, team) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return team.company_id === scope.companyId;
    case 'teams':
      return team.company_id === scope.companyId;
    case 'team':
      return scope.teamIds.includes(team.id);
    default:
      return false;
  }
}

/**
 * Build a WHERE fragment + params scoping the `teams` table (aliased).
 */
export function buildTeamScopeWhere(scope, alias = 't') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams':
      if (!scope.teamIds.length) return { where: 'WHERE 0', params: [] };
      return { where: `WHERE ${alias}.company_id = ? AND ${alias}.id IN (${scope.teamIds.map(() => '?').join(', ')})`, params: [scope.companyId, ...scope.teamIds] };
    case 'team':
      if (!scope.teamIds.length) return { where: 'WHERE 0', params: [] };
      return { where: `WHERE ${alias}.id IN (${scope.teamIds.map(() => '?').join(', ')})`, params: scope.teamIds };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Build a WHERE fragment + params scoping the `leads` table (aliased).
 * Leads belong to a company, an optional team, and are assigned to a user.
 */
export function buildLeadScopeWhere(scope, alias = 'l') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given lead record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target lead row (needs company_id, team_id, assigned_to)
 */
export function canAccessLead(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.assigned_to === scope.selfId;
    case 'self':
      return target.assigned_to === scope.selfId;
    default:
      return false;
  }
}

/**
 * Can the acting user assign a lead to a given target user? Mirrors the user
 * visibility scope (a user can only delegate within what they can see).
 */
export function canAssignLeadTo(scope, targetUser) {
  return canViewUser(scope, targetUser);
}

/**
 * Build a WHERE fragment + params scoping the `customers` table (aliased).
 * Customers mirror the lead scope hierarchy: company / teams / self.
 */
export function buildCustomerScopeWhere(scope, alias = 'c') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams':
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given customer record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target customer row (needs company_id, team_id, assigned_to)
 */
export function canAccessCustomer(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.assigned_to === scope.selfId;
    case 'self':
      return target.assigned_to === scope.selfId;
    default:
      return false;
  }
}

/**
 * Can the acting user assign a customer to a given target user? Mirrors the
 * user visibility scope.
 */
export function canAssignCustomerTo(scope, targetUser) {
  return canViewUser(scope, targetUser);
}

/**
 * Build a WHERE fragment + params scoping the `opportunities` table (aliased).
 * Opportunities mirror the lead/customer hierarchy: company / teams / self.
 */
export function buildOpportunityScopeWhere(scope, alias = 'o') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams':
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given opportunity record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target opportunity row (needs company_id, team_id, assigned_to)
 */
export function canAccessOpportunity(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.assigned_to === scope.selfId;
    case 'self':
      return target.assigned_to === scope.selfId;
    default:
      return false;
  }
}

/**
 * Can the acting user assign an opportunity to a given target user? Mirrors
 * the user visibility scope.
 */
export function canAssignOpportunityTo(scope, targetUser) {
  return canViewUser(scope, targetUser);
}

/**
 * Build a WHERE fragment + params scoping the `follow_ups` table (aliased).
 * Follow-ups mirror the lead/customer hierarchy: company / teams / self,
 * keyed on the assigned salesperson's team.
 */
export function buildFollowUpScopeWhere(scope, alias = 'f') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams':
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given follow-up record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target follow-up row (needs company_id, team_id, assigned_to)
 */
export function canAccessFollowUp(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.assigned_to === scope.selfId;
    case 'self':
      return target.assigned_to === scope.selfId;
    default:
      return false;
  }
}

/**
 * Can the acting user assign a follow-up to a given target user? Mirrors the
 * user visibility scope.
 */
export function canAssignFollowUpTo(scope, targetUser) {
  return canViewUser(scope, targetUser);
}

/**
 * Build a WHERE fragment + params scoping the `targets` table (aliased).
 * Company-level targets (scope company / product / territory) are visible to
 * company scope and above; team and personal targets follow the same
 * team / self hierarchy as leads and opportunities.
 */
export function buildTargetScopeWhere(scope, alias = 't') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams': {
      if (!scope.teamIds.length) {
        return { where: `WHERE ${alias}.company_id = ? AND (${alias}.user_id = ? OR ${alias}.scope IN ('company','product','territory'))`, params: [scope.companyId, scope.selfId] };
      }
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return {
        where: `WHERE ${alias}.company_id = ? AND (${alias}.team_id IN (${placeholders}) OR ${alias}.user_id = ? OR ${alias}.scope IN ('company','product','territory'))`,
        params: [scope.companyId, ...scope.teamIds, scope.selfId],
      };
    }
    case 'team': {
      if (!scope.teamIds.length) {
        return { where: `WHERE ${alias}.company_id = ? AND ${alias}.user_id = ?`, params: [scope.companyId, scope.selfId] };
      }
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return {
        where: `WHERE ${alias}.company_id = ? AND (${alias}.team_id IN (${placeholders}) OR ${alias}.user_id = ?)`,
        params: [scope.companyId, ...scope.teamIds, scope.selfId],
      };
    }
    case 'self':
      return { where: `WHERE ${alias}.company_id = ? AND ${alias}.user_id = ?`, params: [scope.companyId, scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given target record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target target row (needs company_id, scope, team_id, user_id)
 */
export function canAccessTarget(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
      if (target.company_id !== scope.companyId) return false;
      if (scope.teamIds.includes(target.team_id)) return true;
      if (target.user_id === scope.selfId) return true;
      return ['company', 'product', 'territory'].includes(target.scope);
    case 'team':
      if (target.company_id !== scope.companyId) return false;
      return scope.teamIds.includes(target.team_id) || target.user_id === scope.selfId;
    case 'self':
      return target.company_id === scope.companyId && target.user_id === scope.selfId;
    default:
      return false;
  }
}

/**
 * Can the acting user assign a target to a given target user? Mirrors the user
 * visibility scope.
 */
export function canAssignTargetTo(scope, targetUser) {
  return canViewUser(scope, targetUser);
}

/**
 * Build a WHERE fragment + params scoping the `products` table (aliased).
 * Products are company-wide master data shared across a tenant, so every
 * non-super-admin scope collapses to the user's company.
 */
export function buildProductScopeWhere(scope, alias = 'p') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
    case 'teams':
    case 'team':
    case 'self':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given product record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target product row (needs company_id)
 */
export function canAccessProduct(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
    case 'teams':
    case 'team':
    case 'self':
      return target.company_id === scope.companyId;
    default:
      return false;
  }
}

/**
 * Build a WHERE fragment + params scoping the `quotations` table (aliased).
 * Quotations mirror the invoice/customer hierarchy: company / teams / self.
 */
export function buildQuotationScopeWhere(scope, alias = 'q') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams':
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given quotation record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target quotation row (needs company_id, team_id, assigned_to)
 */
export function canAccessQuotation(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.assigned_to === scope.selfId;
    case 'self':
      return target.assigned_to === scope.selfId;
    default:
      return false;
  }
}

/**
 * Build a WHERE fragment + params scoping the `invoices` table (aliased).
 * Invoices mirror the customer/lead hierarchy: company / teams / self.
 */
export function buildInvoiceScopeWhere(scope, alias = 'i') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams':
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given invoice record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target invoice row (needs company_id, team_id, assigned_to)
 */
export function canAccessInvoice(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.assigned_to === scope.selfId;
    case 'self':
      return target.assigned_to === scope.selfId;
    default:
      return false;
  }
}

/**
 * Build a WHERE fragment + params scoping the `orders` table (aliased).
 * Orders mirror the customer/quotation hierarchy: company / teams / self.
 */
export function buildOrderScopeWhere(scope, alias = 'o') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams':
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (${alias}.team_id IN (${placeholders}) OR ${alias}.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE ${alias}.assigned_to = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}

/**
 * Record-level check: can the acting user access a given order record?
 * @param {object} scope result of getUserDataScope
 * @param {object} target order row (needs company_id, team_id, assigned_to)
 */
export function canAccessOrder(scope, target) {
  switch (scope.type) {
    case 'all':
      return true;
    case 'company':
      return target.company_id === scope.companyId;
    case 'teams':
    case 'team':
      return scope.teamIds.includes(target.team_id) || target.assigned_to === scope.selfId;
    case 'self':
      return target.assigned_to === scope.selfId;
    default:
      return false;
  }
}

/**
 * Build a WHERE fragment + params scoping the `payments` table (aliased) via a
 * joined `invoices` table (alias `i`) so payment visibility follows the
 * invoice's company/team/owner scope.
 */
export function buildPaymentScopeWhere(scope, alias = 'p') {
  switch (scope.type) {
    case 'all':
      return { where: '', params: [] };
    case 'company':
      return { where: `WHERE ${alias}.company_id = ?`, params: [scope.companyId] };
    case 'teams':
    case 'team': {
      if (!scope.teamIds.length) return { where: `WHERE i.assigned_to = ?`, params: [scope.selfId] };
      const placeholders = scope.teamIds.map(() => '?').join(', ');
      return { where: `WHERE (i.team_id IN (${placeholders}) OR i.assigned_to = ?)`, params: [...scope.teamIds, scope.selfId] };
    }
    case 'self':
      return { where: `WHERE i.assigned_to = ?`, params: [scope.selfId] };
    default:
      return { where: 'WHERE 0', params: [] };
  }
}
