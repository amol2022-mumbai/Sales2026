import { useCallback, useEffect, useState } from 'react';
import { Users, UserCheck, GitBranch, TrendingUp, CalendarClock, Wallet, RefreshCw } from 'lucide-react';
import { misApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Spinner from '../components/ui/Spinner.jsx';

function currency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
}

function count(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US').format(Number(value));
}

function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value)}%`;
}

export default function MISPage() {
  const { user } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (user?.isSuperAdmin && companyId) params.companyId = companyId;
      setData(await misApi.summary(params));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to, companyId, user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">MIS Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Management information summary computed from real tenant data.</p>
        </div>
        <button type="button" className="btn-primary" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="from">From</label>
            <input id="from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="to">To</label>
            <input id="to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {user?.isSuperAdmin && (
            <div>
              <label className="label" htmlFor="companyId">Company</label>
              <input id="companyId" type="number" className="input w-36" placeholder="Company ID" value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
            </div>
          )}
          {data?.period && (
            <p className="text-xs text-slate-400">
              Period: {data.period.from} → {data.period.to}
            </p>
          )}
        </div>
      </Card>

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
      ) : !data ? null : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Total Leads', value: count(data.leads.total), hint: `${count(data.leads.newInPeriod)} new`, icon: Users },
              { label: 'Total Customers', value: count(data.customers.total), hint: `${count(data.customers.newInPeriod)} new`, icon: UserCheck },
              { label: 'Open Pipeline', value: currency(data.pipeline.openValue), hint: `${count(data.pipeline.openCount)} deals`, icon: GitBranch },
              { label: 'Won Sales', value: currency(data.sales.wonValue), hint: `${count(data.sales.wonCount)} deals`, icon: TrendingUp },
              { label: 'Conversion', value: pct(data.sales.conversionRate), hint: 'Won / closed', icon: CalendarClock },
              { label: 'Collected', value: currency(data.collections.collected), hint: 'Payments received', icon: Wallet },
            ].map((k) => (
              <Card key={k.label} className="p-4">
                <div className="flex items-center gap-2">
                  <k.icon className="h-4 w-4 text-brand-500" />
                  <p className="text-xs font-medium text-slate-500">{k.label}</p>
                </div>
                <p className="mt-2 text-xl font-semibold text-slate-900">{k.value}</p>
                <p className="text-xs text-slate-400">{k.hint}</p>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Pipeline</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Open value</span>
                  <span className="font-medium text-slate-900">{currency(data.pipeline.openValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Weighted value</span>
                  <span className="font-medium text-slate-900">{currency(data.pipeline.weightedValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Won value</span>
                  <span className="font-medium text-emerald-600">{currency(data.sales.wonValue)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Follow-ups</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Pending</span>
                  <span className="font-medium text-slate-900">{count(data.followUps.pending)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Completed</span>
                  <span className="font-medium text-slate-900">{count(data.followUps.completed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Overdue</span>
                  <span className="font-medium text-rose-600">{count(data.followUps.overdue)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5 lg:col-span-2">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Collections</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Invoices</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{count(data.collections.invoiceCount)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Invoiced</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{currency(data.collections.invoiced)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Collected</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-600">{currency(data.collections.collected)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Outstanding</p>
                  <p className="mt-1 text-lg font-semibold text-rose-600">{currency(data.collections.outstanding)}</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
