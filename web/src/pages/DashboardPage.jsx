import { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { UserPlus, Users, FolderKanban, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import { dashboardApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import KpiCard from '../components/ui/KpiCard.jsx';
import DashboardChart from '../components/ui/DashboardChart.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { remainingDaysLabel } from '../lib/license.js';

function kpiValue(kpis, key) {
  const kpi = kpis.find((k) => k.key === key);
  return kpi ? Number(kpi.value) || 0 : 0;
}

export default function DashboardPage() {
  const { user, tenant } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    dashboardApi
      .summary()
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);

  // Super admins have a dedicated platform dashboard under /admin.
  if (user?.isSuperAdmin) {
    return <Navigate to="/admin" replace />;
  }

  const license = tenant?.license;
  const leads = data ? kpiValue(data.kpis, 'leads') : 0;
  const customers = data ? kpiValue(data.kpis, 'customers') : 0;
  const isEmptyWorkspace = data && leads === 0 && customers === 0;

  const gettingStarted = [
    { key: 'leads', label: 'Add your first lead', text: 'Capture a prospect to start building your pipeline.', to: '/leads', done: leads > 0, icon: UserPlus, show: can(user, 'leads:view') },
    { key: 'customers', label: 'Add your first customer', text: 'Create a customer record to attach deals, quotes and orders.', to: '/customers', done: customers > 0, icon: FolderKanban, show: can(user, 'customers:view') },
    { key: 'team', label: 'Invite your teammates', text: 'Bring your sales team into the workspace.', to: '/users', done: null, icon: Users, show: can(user, 'users:view') },
  ].filter((i) => i.show);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Welcome back, {user?.name}. Here&apos;s your {data?.company?.name ? `${data.company.name} ` : ''}sales overview.
        </p>
      </div>

      {license && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="font-medium text-slate-700">{license.planName || license.planKey || 'Plan'}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              license.status === 'active'
                ? 'bg-emerald-100 text-emerald-700'
                : license.status === 'trial'
                  ? 'bg-indigo-100 text-indigo-700'
                  : license.status === 'expiring'
                    ? 'bg-sky-100 text-sky-700'
                    : 'bg-slate-100 text-slate-600'
            }`}
          >
            {license.status}
          </span>
          {(license.status === 'trial' || license.status === 'expiring') && remainingDaysLabel(license.expiresAt) && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
              <Sparkles className="h-3.5 w-3.5 text-slate-400" /> {remainingDaysLabel(license.expiresAt)}
            </span>
          )}
          {license.expiresAt && license.status !== 'trial' && license.status !== 'expiring' && (
            <span className="text-xs text-slate-500">Expires {license.expiresAt}</span>
          )}
          {license.userLimit > 0 && <span className="text-xs text-slate-500">{license.userLimit} seats</span>}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {!data && !error ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : (
        <>
          {isEmptyWorkspace && (
            <section className="rounded-xl border border-brand-100 bg-white p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Let&apos;s get your workspace going</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    A few quick steps and your team will be ready to sell. Everything below reflects your real data.
                  </p>
                </div>
              </div>
              <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {gettingStarted.map((item) => (
                  <li key={item.key}>
                    <Link
                      to={item.to}
                      className="group flex h-full items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-brand-300 hover:shadow-sm"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 group-hover:bg-brand-50 group-hover:text-brand-600">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-800">{item.label}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{item.text}</p>
                      </div>
                      {item.done === true ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                      ) : item.done === false ? (
                        <Circle className="h-5 w-5 shrink-0 text-slate-300" />
                      ) : (
                        <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Start
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {data.kpis.map((kpi) => (
              <KpiCard key={kpi.key} kpi={kpi} />
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Object.values(data.charts).map((chart) => (
              <div key={chart.title} className="h-72">
                <DashboardChart title={chart.title} labels={chart.labels} series={chart.series} />
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-400">
            All figures reflect live data — no placeholder numbers are generated.
          </p>
        </>
      )}
    </div>
  );
}
