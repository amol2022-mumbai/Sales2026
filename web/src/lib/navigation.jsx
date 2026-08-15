import {
  LayoutDashboard,
  Users,
  UserCheck,
  GitBranch,
  CalendarClock,
  TrendingUp,
  FileText,
  ShoppingCart,
  Wallet,
  Package,
  UserCog,
  Target,
  Map,
  Receipt,
  BarChart3,
  PieChart,
  Sparkles,
  Bell,
  ScrollText,
  Settings,
  ShieldCheck,
  CreditCard,
} from 'lucide-react';

export const NAV_SECTIONS = [
  {
    title: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard, functional: true, permission: 'dashboard:view' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { key: 'leads', label: 'Leads', path: '/leads', icon: Users, functional: true, permission: 'leads:view' },
      { key: 'customers', label: 'Customers', path: '/customers', icon: UserCheck, functional: true, permission: 'customers:view' },
      { key: 'pipeline', label: 'Pipeline', path: '/pipeline', icon: GitBranch, functional: true, permission: 'pipeline:view' },
      { key: 'followups', label: 'Follow-ups', path: '/follow-ups', icon: CalendarClock, functional: true, permission: 'followups:view' },
      { key: 'sales', label: 'Sales', path: '/sales', icon: TrendingUp, permission: 'sales:view' },
      { key: 'quotations', label: 'Quotations', path: '/quotations', icon: FileText, permission: 'quotations:view' },
      { key: 'orders', label: 'Orders', path: '/orders', icon: ShoppingCart, permission: 'orders:view' },
      { key: 'collections', label: 'Collections', path: '/collections', icon: Wallet, functional: true, permission: 'collections:view' },
    ],
  },
  {
    title: 'Manage',
    items: [
      { key: 'products', label: 'Products', path: '/products', icon: Package, functional: true, permission: 'products:view' },
      { key: 'sales_team', label: 'Sales Team', path: '/sales-team', icon: UserCog, functional: true, permission: 'sales_team:view' },
      { key: 'targets', label: 'Targets', path: '/targets', icon: Target, functional: true, permission: 'targets:view' },
      { key: 'territories', label: 'Territories', path: '/territories', icon: Map, permission: 'territories:view' },
      { key: 'expenses', label: 'Expenses', path: '/expenses', icon: Receipt, permission: 'expenses:view' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { key: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, functional: true, permission: 'reports:view' },
      { key: 'mis', label: 'MIS', path: '/mis', icon: PieChart, functional: true, permission: 'mis:view' },
      { key: 'ai_assistant', label: 'AI Assistant', path: '/ai-assistant', icon: Sparkles, functional: true, permission: 'ai_assistant:view' },
    ],
  },
  {
    title: 'System',
    items: [
      { key: 'users', label: 'Users', path: '/users', icon: UserCog, functional: true, permission: 'users:view' },
      { key: 'roles', label: 'Roles & Permissions', path: '/roles', icon: ShieldCheck, functional: true, permission: 'roles:view' },
      { key: 'billing', label: 'Billing', path: '/billing', icon: CreditCard, functional: true, permission: 'billing:view' },
      { key: 'notifications', label: 'Notifications', path: '/notifications', icon: Bell, permission: 'notifications:view' },
      { key: 'audit_logs', label: 'Audit Logs', path: '/audit-logs', icon: ScrollText, permission: 'audit_logs:view' },
      { key: 'settings', label: 'Settings', path: '/settings', icon: Settings, functional: true, permission: 'settings:view' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

// Modules that are always visible (system/core), never gated by a license.
const CORE_NAV_KEYS = new Set(['users', 'roles', 'notifications', 'audit_logs', 'settings', 'billing']);

export function isModuleEnabledForTenant(tenant, key) {
  if (!tenant?.license?.modules) return true; // null = all modules
  if (CORE_NAV_KEYS.has(key)) return true;
  return tenant.license.modules.includes(key);
}
