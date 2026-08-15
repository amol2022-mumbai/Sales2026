// ============================================================================
// Module catalog. Defines the configurable feature modules of the product so
// that a Super Admin can enable/disable them per client (white-label). Module
// keys mirror the permission `module` values in permissions.js.
//
// - `core` modules are always available and cannot be disabled (users, roles,
//   settings, notifications, audit logs, companies).
// - `functional` marks modules whose UI/API is shipped in this build; others
//   are placeholders that can be toggled for future releases.
// ============================================================================

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', description: 'Sales overview and KPI dashboard', functional: true, core: false },
  { key: 'leads', label: 'Leads', description: 'Capture, qualify and manage sales leads', functional: true, core: false },
  { key: 'customers', label: 'Customers', description: 'Manage accounts and customer relationships', functional: true, core: false },
  { key: 'pipeline', label: 'Pipeline', description: 'Track opportunities from lead to won deal', functional: true, core: false },
  { key: 'followups', label: 'Follow-ups', description: 'Schedule and complete follow-up activities', functional: true, core: false },
  { key: 'sales', label: 'Sales', description: 'Sales orders and revenue tracking', functional: false, core: false },
  { key: 'targets', label: 'Targets', description: 'Sales targets and team performance', functional: true, core: false },
  { key: 'sales_team', label: 'Sales Team', description: 'Teams, roles and hierarchy management', functional: true, core: false },
  { key: 'quotations', label: 'Quotations', description: 'Create and send quotations', functional: true, core: false },
  { key: 'orders', label: 'Orders', description: 'Sales order management', functional: true, core: false },
  { key: 'collections', label: 'Collections', description: 'Payment collections and receivables', functional: true, core: false },
  { key: 'products', label: 'Products', description: 'Product and service catalogue', functional: true, core: false },
  { key: 'territories', label: 'Territories', description: 'Sales territory management', functional: false, core: false },
  { key: 'expenses', label: 'Expenses', description: 'Expense tracking and approvals', functional: false, core: false },
  { key: 'reports', label: 'Reports', description: 'Sales and performance reports', functional: true, core: false },
  { key: 'mis', label: 'MIS', description: 'Management information system', functional: true, core: false },
  { key: 'ai_assistant', label: 'AI Assistant', description: 'AI-powered sales insights', functional: true, core: false },
];

// Core/system modules are not listed above (they are always enabled).
export const CORE_MODULES = ['notifications', 'audit_logs', 'settings', 'users', 'roles', 'companies', 'search'];

export const ALL_MODULE_KEYS = [...MODULES.map((m) => m.key), ...CORE_MODULES];

export function getModule(key) {
  return MODULES.find((m) => m.key === key) || null;
}

export function isCoreModule(key) {
  return CORE_MODULES.includes(key);
}

export function isValidModuleKey(key) {
  return ALL_MODULE_KEYS.includes(key);
}

/**
 * Normalize a modules input (array of keys) into a canonical sorted list of
 * valid, non-core module keys. Returns `null` when the input means "all
 * modules" (undefined/null), so callers can distinguish "inherit/all" from an
 * explicit (possibly empty) selection.
 */
export function normalizeModules(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) return null;
  const keys = [...new Set(input.filter((k) => isValidModuleKey(k) && !isCoreModule(k)))].sort();
  return keys;
}
