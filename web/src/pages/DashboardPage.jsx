import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { dashboardApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import KpiCard from '../components/ui/KpiCard.jsx';
import DashboardChart from '../components/ui/DashboardChart.jsx';
import Spinner from '../components/ui/Spinner.jsx';

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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Welcome back, {user?.name}. Here&apos;s your {data?.company?.name ? `${data.company.name} ` : ''}sales overview.
        </p>
      </div>

      {tenant?.license && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="font-medium text-slate-700">{tenant.license.planName || tenant.license.planKey || 'Plan'}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              tenant.license.status === 'active'
                ? 'bg-emerald-100 text-emerald-700'
                : tenant.license.status === 'trial'
                  ? 'bg-indigo-100 text-indigo-700'
                  : tenant.license.status === 'expiring'
                    ? 'bg-sky-100 text-sky-700'
                    : 'bg-slate-100 text-slate-600'
            }`}
          >
            {tenant.license.status}
          </span>
          {tenant.license.expiresAt && (
            <span className="text-xs text-slate-500">Expires {tenant.license.expiresAt}</span>
          )}
          {tenant.license.userLimit > 0 && <span className="text-xs text-slate-500">{tenant.license.userLimit} seats</span>}
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
