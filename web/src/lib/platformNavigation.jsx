import {
  LayoutDashboard,
  Building2,
  KeyRound,
  CreditCard,
  Repeat,
  Users,
  ToggleRight,
  Gauge,
  BarChart3,
  FileText,
  ShieldCheck,
  Settings,
  Activity,
  BellRing,
} from 'lucide-react';

// Dedicated SaaS platform navigation for the Super Admin. Completely separate
// from the tenant/CRM navigation used by company users.
export const PLATFORM_NAV_SECTIONS = [
  {
    title: 'Platform',
    items: [
      { key: 'platform_dashboard', label: 'Platform Dashboard', path: '/admin', icon: LayoutDashboard, end: true },
      { key: 'companies', label: 'Companies / Tenants', path: '/admin/companies', icon: Building2 },
      { key: 'plans', label: 'Plans', path: '/admin/plans', icon: KeyRound },
      { key: 'licenses', label: 'Licenses', path: '/admin/licenses', icon: CreditCard },
    ],
  },
  {
    title: 'Operations',
    items: [
      { key: 'control_center', label: 'Control Center', path: '/admin/operations', icon: Activity },
      { key: 'alerts', label: 'Alerts', path: '/admin/alerts', icon: BellRing },
      { key: 'subscriptions', label: 'Subscriptions', path: '/admin/subscriptions', icon: Repeat },
      { key: 'tenant_users', label: 'Tenant Users', path: '/admin/tenant-users', icon: Users },
      { key: 'entitlements', label: 'Feature Entitlements', path: '/admin/entitlements', icon: ToggleRight },
      { key: 'usage', label: 'Usage & Limits', path: '/admin/usage', icon: Gauge },
    ],
  },
  {
    title: 'Insights',
    items: [
      { key: 'analytics', label: 'Tenant Analytics', path: '/admin/analytics', icon: BarChart3 },
      { key: 'reports', label: 'Platform Reports', path: '/admin/reports', icon: FileText },
    ],
  },
  {
    title: 'Governance',
    items: [
      { key: 'audit', label: 'Audit & Security', path: '/admin/audit', icon: ShieldCheck },
      { key: 'settings', label: 'System Settings', path: '/admin/settings', icon: Settings },
    ],
  },
];

export const ALL_PLATFORM_NAV_ITEMS = PLATFORM_NAV_SECTIONS.flatMap((s) => s.items);

// Maps a platform route path to the section key rendered by AdminPage.
export function platformSectionFromPath(pathname) {
  const item = ALL_PLATFORM_NAV_ITEMS.find((i) => i.path === pathname);
  return item?.key || 'platform_dashboard';
}
