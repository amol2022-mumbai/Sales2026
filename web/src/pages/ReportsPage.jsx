import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { reportsApi, usersApi, teamsApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import { getToken } from '../api/client.js';
import Card from '../components/ui/Card.jsx';
import Spinner from '../components/ui/Spinner.jsx';

function formatCell(value, format) {
  if (value == null) return '—';
  if (format === 'currency') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
  }
  if (format === 'percent') return `${Number(value)}%`;
  if (format === 'number') return new Intl.NumberFormat('en-US').format(Number(value));
  return String(value);
}

const PERIODS = [['', 'Total'], ['day', 'Day'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];

export default function ReportsPage() {
  const { user } = useAuth();
  const [types, setTypes] = useState([]);
  const [type, setType] = useState('sales');

  const [period, setPeriod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState('');

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null);

  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    reportsApi.types().then(setTypes).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
    teamsApi.list({ pageSize: 100 }).then((r) => setTeams(r.data)).catch(() => {});
  }, []);

  const buildParams = useCallback(
    () => {
      const params = {};
      if (period) params.period = period;
      if (from) params.from = from;
      if (to) params.to = to;
      if (salespersonId) params.salespersonId = salespersonId;
      if (teamId) params.teamId = teamId;
      if (status) params.status = status;
      if (search) params.search = search;
      if (sortBy && sortDir) {
        params.sortBy = sortBy;
        params.sortDir = sortDir;
      }
      if (user?.isSuperAdmin && companyId) params.companyId = companyId;
      return params;
    },
    [period, from, to, salespersonId, teamId, status, search, sortBy, sortDir, companyId, user]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await reportsApi.get(type, buildParams()));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [type, buildParams]);

  useEffect(() => {
    load();
  }, [load]);

  function download(format) {
    setExporting(format);
    const url = reportsApi.exportUrl(type, { ...buildParams(), format });
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${type}.${format === 'xlsx' ? 'xlsx' : format === 'pdf' ? 'pdf' : 'csv'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => setError(e.message))
      .finally(() => setExporting(null));
  }

  const currentType = types.find((t) => t.key === type);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Real-time, tenant-scoped reports with CSV, XLSX and PDF export.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user, 'reports:export') && (
            <>
              <button type="button" className="btn-secondary" disabled={!!exporting} onClick={() => download('csv')}>
                <Download className="h-4 w-4" /> CSV
              </button>
              <button type="button" className="btn-secondary" disabled={!!exporting} onClick={() => download('xlsx')}>
                <Download className="h-4 w-4" /> XLSX
              </button>
              <button type="button" className="btn-secondary" disabled={!!exporting} onClick={() => download('pdf')}>
                <Download className="h-4 w-4" /> PDF
              </button>
            </>
          )}
          <button type="button" className="btn-primary" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="reportType">Report</label>
            <select id="reportType" className="input w-64" value={type} onChange={(e) => { setType(e.target.value); setSortBy(''); setSortDir(''); }}>
              {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="period">Period</label>
            <select id="period" className="input w-40" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map(([v, l]) => <option key={v || 'total'} value={v}>{l}</option>)}
            </select>
          </div>
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
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="relative">
            <label className="label" htmlFor="search">Search</label>
            <input id="search" className="input w-52" placeholder="Search rows…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="salesperson">Salesperson</label>
            <select id="salesperson" className="input w-44" value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)}>
              <option value="">All</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="team">Team</label>
            <select id="team" className="input w-44" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">All</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <input id="status" className="input w-40" placeholder="e.g. Active" value={status} onChange={(e) => setStatus(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
        ) : !report ? null : report.rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">No data for the selected filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                  {report.columns.map((c) => (
                    <th key={c.key} className="px-4 py-3 font-semibold">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {report.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {report.columns.map((c) => (
                      <td key={c.key} className={`px-4 py-2.5 ${c.format === 'currency' || c.format === 'number' || c.format === 'percent' ? 'tabular-nums' : ''}`}>
                        {formatCell(r[c.key], c.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
