// ============================================================================
// Permission catalog and role->permission mapping.
// Permissions use the `module:action` convention.
// Actions: view, create, edit, delete, export, approve, assign, manage.
// ============================================================================

const ACTIONS = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  export: 'Export',
  approve: 'Approve',
  assign: 'Assign',
  manage: 'Manage',
};

const MODULES = [
  'dashboard',
  'leads',
  'customers',
  'pipeline',
  'followups',
  'sales',
  'quotations',
  'orders',
  'collections',
  'products',
  'sales_team',
  'targets',
  'territories',
  'expenses',
  'reports',
  'mis',
  'ai_assistant',
  'notifications',
  'audit_logs',
  'settings',
  'users',
  'roles',
  'companies',
];

// Admin modules expose a `manage` capability; business modules expose the full
// CRUD + export + approve + assign set.
const ADMIN_MODULES = ['users', 'roles', 'companies', 'settings', 'audit_logs'];
const BUSINESS_ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve', 'assign'];
const ADMIN_ACTIONS = ['view', 'create', 'edit', 'delete', 'manage'];

function buildPermissionList() {
  const list = [];
  let order = 0;

  for (const module of MODULES) {
    const actions = ADMIN_MODULES.includes(module) ? ADMIN_ACTIONS : BUSINESS_ACTIONS;
    for (const action of actions) {
      list.push({
        key: `${module}:${action}`,
        module,
        action,
        name: `${titleCase(module)} ${ACTIONS[action]}`,
        sort_order: order++,
      });
    }
  }
  return list;
}

function titleCase(s) {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Helper: full CRUD + export for business modules.
function mod(...modules) {
  const keys = [];
  for (const m of modules) {
    for (const a of ['view', 'create', 'edit', 'delete', 'export']) keys.push(`${m}:${a}`);
  }
  return keys;
}

// Helper: approve + assign capabilities (manager-level workflows).
function approveAssign(...modules) {
  const keys = [];
  for (const m of modules) {
    keys.push(`${m}:approve`, `${m}:assign`);
  }
  return keys;
}

function admin(...modules) {
  const keys = [];
  for (const m of modules) {
    for (const a of ADMIN_ACTIONS) keys.push(`${m}:${a}`);
  }
  return keys;
}

// Read-only modules.
function readonly(...modules) {
  const keys = [];
  for (const m of modules) keys.push(`${m}:view`);
  return keys;
}

// Role -> list of permission keys. Super admin is implicit (is_super_admin).
export const ROLE_PERMISSIONS = {
  // Full company access: every business module + team/user/settings management.
  // Excludes cross-company & system administration (reserved for super admin).
  business_owner: [
    ...mod(
      'dashboard',
      'leads',
      'customers',
      'pipeline',
      'followups',
      'sales',
      'quotations',
      'orders',
      'collections',
      'products',
      'sales_team',
      'targets',
      'territories',
      'expenses',
      'reports',
      'mis',
      'ai_assistant'
    ),
    ...approveAssign(
      'leads',
      'customers',
      'sales',
      'quotations',
      'orders',
      'collections',
      'expenses',
      'targets',
      'followups',
      'pipeline',
      'sales_team'
    ),
    ...admin('users', 'settings'),
    ...readonly('roles', 'audit_logs', 'notifications'),
    'notifications:edit',
  ],
  sales_manager: [
    ...mod(
      'dashboard',
      'leads',
      'customers',
      'pipeline',
      'followups',
      'sales',
      'quotations',
      'orders',
      'collections',
      'products',
      'targets',
      'territories',
      'reports'
    ),
    ...approveAssign('leads', 'followups', 'pipeline', 'sales', 'quotations', 'orders', 'collections', 'targets'),
    'sales_team:view',
    'sales_team:edit',
    'sales_team:assign',
    'users:view',
    'users:create',
    'users:edit',
    ...readonly('roles', 'mis', 'ai_assistant', 'expenses', 'notifications', 'audit_logs'),
    'settings:view',
  ],
  team_leader: [
    ...mod(
      'dashboard',
      'leads',
      'customers',
      'pipeline',
      'followups',
      'sales',
      'quotations',
      'orders',
      'targets'
    ),
    ...approveAssign('leads', 'followups', 'pipeline'),
    ...readonly(
      'sales_team',
      'roles',
      'collections',
      'products',
      'territories',
      'reports',
      'expenses',
      'notifications',
      'ai_assistant'
    ),
    'users:view',
    'users:edit',
  ],
  sales_executive: [
    ...mod('dashboard', 'leads', 'customers', 'pipeline', 'followups', 'sales', 'quotations'),
    ...readonly('orders', 'products', 'targets', 'notifications', 'users', 'ai_assistant'),
  ],
  accountant: [
    ...mod('dashboard', 'sales', 'orders', 'collections', 'expenses', 'reports'),
    ...approveAssign('expenses', 'collections'),
    ...readonly(
      'leads',
      'customers',
      'pipeline',
      'followups',
      'quotations',
      'products',
      'mis',
      'notifications',
      'sales_team',
      'users',
      'roles'
    ),
  ],
  viewer: readonly(
    'dashboard',
    'leads',
    'customers',
    'pipeline',
    'followups',
    'sales',
    'quotations',
    'orders',
    'collections',
    'products',
    'sales_team',
    'targets',
    'territories',
    'expenses',
    'reports',
    'mis',
    'notifications',
    'users',
    'roles'
  ),
};

export const PERMISSIONS = buildPermissionList();

// Role seed definitions.
export const ROLES = [
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Unrestricted platform access across all companies and modules.',
    is_super_admin: 1,
  },
  {
    key: 'business_owner',
    name: 'Business Owner',
    description: 'Full control over a single company, including users and settings.',
    is_super_admin: 0,
  },
  {
    key: 'sales_manager',
    name: 'Sales Manager',
    description: 'Manages the sales pipeline, team and reports.',
    is_super_admin: 0,
  },
  {
    key: 'team_leader',
    name: 'Team Leader',
    description: 'Leads a sales team and manages their day-to-day records.',
    is_super_admin: 0,
  },
  {
    key: 'sales_executive',
    name: 'Sales Executive',
    description: 'Works leads, customers and follow-ups.',
    is_super_admin: 0,
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Manages collections, expenses and financial reports.',
    is_super_admin: 0,
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to business modules.',
    is_super_admin: 0,
  },
];
