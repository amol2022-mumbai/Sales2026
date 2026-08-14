import { Users, UserCheck, TrendingUp, Target, CalendarClock, Wallet, Receipt, CreditCard, GitBranch } from 'lucide-react';

const ICONS = {
  leads: Users,
  customers: UserCheck,
  monthlySales: TrendingUp,
  targetAchievement: Target,
  followUps: CalendarClock,
  outstanding: Wallet,
  invoiced: Receipt,
  collected: CreditCard,
  payments: Wallet,
  openPipeline: GitBranch,
};

const COLORS = {
  leads: 'bg-brand-50 text-brand-600',
  customers: 'bg-emerald-50 text-emerald-600',
  monthlySales: 'bg-violet-50 text-violet-600',
  targetAchievement: 'bg-amber-50 text-amber-600',
  followUps: 'bg-sky-50 text-sky-600',
  outstanding: 'bg-rose-50 text-rose-600',
  invoiced: 'bg-indigo-50 text-indigo-600',
  collected: 'bg-emerald-50 text-emerald-600',
  payments: 'bg-sky-50 text-sky-600',
  openPipeline: 'bg-violet-50 text-violet-600',
};

function formatValue(value, format) {
  if (format === 'currency') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  }
  if (format === 'percent') return `${value}%`;
  return new Intl.NumberFormat('en-US').format(value);
}

export default function KpiCard({ kpi }) {
  const Icon = ICONS[kpi.key] || TrendingUp;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${COLORS[kpi.key] || 'bg-slate-100 text-slate-500'}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-semibold text-slate-900">{formatValue(kpi.value, kpi.format)}</p>
      <p className="mt-1 text-sm font-medium text-slate-600">{kpi.label}</p>
      <p className="mt-0.5 text-xs text-slate-400">{kpi.hint}</p>
    </div>
  );
}
