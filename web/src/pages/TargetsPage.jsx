import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search, Download, Users, TrendingUp, Target, Wallet, BarChart3 } from 'lucide-react';
import { targetsApi, usersApi, teamsApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import { getToken } from '../api/client.js';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';

const SCOPE_LABELS = { company: 'Company', team: 'Team', user: 'Salesperson', product: 'Product', territory: 'Territory' };
const TYPE_LABELS = {
  sales: 'Sales / Revenue',
  collection: 'Collection',
  new_leads: 'New Leads',
  new_customers: 'New Customers',
  conversion_rate: 'Conversion Rate',
};
const PERIOD_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };
const STATUS_TONE = { Active: 'green', Paused: 'amber', Completed: 'indigo', Cancelled: 'rose' };
const TYPE_UNITS = {
  sales: 'currency',
  collection: 'currency',
  new_leads: 'count',
  new_customers: 'count',
  conversion_rate: 'percent',
};

const EMPTY_FORM = {
  scope: 'company',
  userId: '',
  teamId: '',
  product: '',
  territory: '',
  targetType: 'sales',
  periodType: 'monthly',
  targetValue: '',
  startDate: '',
  endDate: '',
  status: 'Active',
  companyId: '',
};

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

function formatValue(value, targetType) {
  if (TYPE_UNITS[targetType] === 'currency') return currency(value);
  if (TYPE_UNITS[targetType] === 'percent') return pct(value);
  return count(value);
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TargetsPage() {
  const { user } = useAuth();

  const [tab, setTab] = useState('overview');
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [dash, setDash] = useState(null);
  const [metaInfo, setMetaInfo] = useState({ scopes: [], types: [], periods: [], statuses: [] });
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [scorecard, setScorecard] = useState(null);
  const [compare, setCompare] = useState(null);

  const [search, setSearch] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(1);

  const [scoreUser, setScoreUser] = useState('');
  const [groupBy, setGroupBy] = useState('month');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, pageSize: 10, sort, order };
      if (search) params.search = search;
      if (targetTypeFilter) params.targetType = targetTypeFilter;
      if (scopeFilter) params.scope = scopeFilter;
      if (periodFilter) params.periodType = periodFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await targetsApi.list(params);
      setItems(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, targetTypeFilter, scopeFilter, periodFilter, statusFilter, sort, order]);

  const loadDashboard = useCallback(async () => {
    try {
      setDash(await targetsApi.dashboard());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const loadScorecard = useCallback(async () => {
    try {
      const params = { groupBy };
      if (scoreUser) params.userId = scoreUser;
      setScorecard(await targetsApi.scorecard(params));
    } catch (e) {
      setError(e.message);
    }
  }, [scoreUser, groupBy]);

  const loadCompare = useCallback(async () => {
    try {
      setCompare(await targetsApi.compare());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    targetsApi.meta().then(setMetaInfo).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
    teamsApi.list({ pageSize: 100 }).then((r) => setTeams(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'overview') loadDashboard();
    if (tab === 'scorecard') loadScorecard();
    if (tab === 'compare') loadCompare();
  }, [tab, loadDashboard, loadScorecard, loadCompare]);

  function refresh() {
    load();
    loadDashboard();
  }

  function update(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(t) {
    setEditing(t);
    setForm({
      scope: t.scope || 'company',
      userId: t.userId ?? '',
      teamId: t.teamId ?? '',
      product: t.product || '',
      territory: t.territory || '',
      targetType: t.targetType || 'sales',
      periodType: t.periodType || 'monthly',
      targetValue: t.targetValue ?? '',
      startDate: t.startDate || '',
      endDate: t.endDate || '',
      status: t.status || 'Active',
      companyId: t.companyId ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function buildPayload() {
    const scope = form.scope;
    return {
      scope,
      userId: scope === 'user' && form.userId ? Number(form.userId) : null,
      teamId: scope === 'team' && form.teamId ? Number(form.teamId) : null,
      product: scope === 'product' && form.product ? form.product : null,
      territory: scope === 'territory' && form.territory ? form.territory : null,
      targetType: form.targetType,
      periodType: form.periodType,
      targetValue: Number(form.targetValue),
      startDate: form.startDate,
      endDate: form.endDate,
      status: form.status,
      companyId: user?.isSuperAdmin && form.companyId ? Number(form.companyId) : null,
    };
  }

  function validate() {
    if (!form.targetValue || Number(form.targetValue) <= 0) return 'Target value must be a positive number.';
    if (!form.startDate || !form.endDate) return 'Start and end dates are required.';
    if (form.endDate < form.startDate) return 'End date must be on or after start date.';
    if (form.scope === 'user' && !form.userId) return 'Select a salesperson for a user target.';
    if (form.scope === 'team' && !form.teamId) return 'Select a team for a team target.';
    if (form.scope === 'product' && !form.product) return 'Enter a product/service for a product target.';
    if (form.scope === 'territory' && !form.territory) return 'Enter a territory for a territory target.';
    return null;
  }

  async function save(e) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setFormError(v);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await targetsApi.update(editing.id, buildPayload());
        setMessage('Target updated.');
      } else {
        await targetsApi.create(buildPayload());
        setMessage('Target created.');
      }
      setFormOpen(false);
      refresh();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(t) {
    setDeleting(t.id);
    try {
      await targetsApi.remove(t.id);
      setMessage('Target deleted.');
      setDeleting(null);
      refresh();
    } catch (e) {
      setError(e.message);
      setDeleting(null);
    }
  }

  function downloadExport(format) {
    const params = { format };
    if (search) params.search = search;
    if (targetTypeFilter) params.targetType = targetTypeFilter;
    if (scopeFilter) params.scope = scopeFilter;
    if (periodFilter) params.periodType = periodFilter;
    if (statusFilter) params.status = statusFilter;
    const url = targetsApi.exportUrl(params);
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = format === 'xlsx' ? 'targets.xlsx' : 'targets.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => setError(err.message));
  }

  const kpis = useMemo(() => {
    if (!dash) return [];
    const s = dash.summary;
    return [
      { label: 'Active Targets', value: count(s.activeTargets), hint: `${s.totalTargets} total` },
      { label: 'Target Value', value: currency(s.targetValue), hint: 'Total across targets' },
      { label: 'Achievement', value: currency(s.achievement), hint: 'Real results' },
      { label: 'Balance', value: currency(s.balance), hint: 'Target − achievement' },
      { label: 'Achievement %', value: pct(s.achievementPct), hint: 'Overall' },
    ];
  }, [dash]);

  const scoreTargetValue = useMemo(() => {
    if (!scorecard) return 0;
    return scorecard.targets.reduce((s, t) => s + (t.targetValue || 0), 0);
  }, [scorecard]);

  const scopeBadge = (t) => <Badge tone="slate">{SCOPE_LABELS[t.scope] || t.scope}</Badge>;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Targets & Team Performance</h1>
          <p className="mt-1 text-sm text-slate-500">Set company, team, salesperson, product and territory targets and track achievement.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user, 'targets:export') && (
            <>
              <button type="button" className="btn-secondary" onClick={() => downloadExport('csv')}>
                <Download className="h-4 w-4" /> CSV
              </button>
              <button type="button" className="btn-secondary" onClick={() => downloadExport('xlsx')}>
                <Download className="h-4 w-4" /> XLSX
              </button>
            </>
          )}
          {can(user, 'targets:create') && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add target
            </button>
          )}
        </div>
      </div>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="flex rounded-lg border border-slate-200 p-0.5">
        {[
          ['overview', 'Overview', BarChart3],
          ['targets', 'Targets', Target],
          ['scorecard', 'Scorecard', Users],
          ['compare', 'Compare', TrendingUp],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setTab(key)}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          {dash ? (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                {kpis.map((k) => (
                  <Card key={k.label} className="p-4">
                    <p className="text-xl font-semibold text-slate-900">{k.value}</p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">{k.label}</p>
                    <p className="text-xs text-slate-400">{k.hint}</p>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card className="p-5">
                  <h3 className="mb-4 text-sm font-semibold text-slate-700">Achievement by target type</h3>
                  {dash.byType.length === 0 ? (
                    <p className="text-sm text-slate-400">No targets yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {dash.byType.map((t) => (
                        <div key={t.type}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-700">{TYPE_LABELS[t.type] || t.type}</span>
                            <span className="text-slate-500">{formatValue(t.achievement, t.type)} / {formatValue(t.targetValue, t.type)}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{ width: `${Math.min(t.achievementPct, 100)}%` }}
                            />
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">{t.achievementPct}% achieved</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="p-5">
                  <h3 className="mb-4 text-sm font-semibold text-slate-700">Pipeline & activities</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-slate-400">Open pipeline</p><p className="font-semibold text-slate-900">{currency(dash.pipeline.openValue)}</p></div>
                    <div><p className="text-xs text-slate-400">Weighted pipeline</p><p className="font-semibold text-slate-900">{currency(dash.pipeline.weightedValue)}</p></div>
                    <div><p className="text-xs text-slate-400">Won value</p><p className="font-semibold text-emerald-600">{currency(dash.pipeline.wonValue)}</p></div>
                    <div><p className="text-xs text-slate-400">Conversion rate</p><p className="font-semibold text-slate-900">{pct(dash.pipeline.conversionRate)}</p></div>
                    <div><p className="text-xs text-slate-400">Completed activities</p><p className="font-semibold text-slate-900">{count(dash.activities.completed)}</p></div>
                    <div><p className="text-xs text-slate-400">Collections</p><p className="font-semibold text-slate-900">{currency(dash.collections.achieved)}</p></div>
                  </div>
                </Card>
              </div>

              <Card className="p-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-700">Performance ranking</h3>
                {dash.ranking.length === 0 ? (
                  <p className="text-sm text-slate-400">No targets to rank.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2 font-semibold">#</th>
                          <th className="px-3 py-2 font-semibold">Entity</th>
                          <th className="px-3 py-2 font-semibold">Type</th>
                          <th className="px-3 py-2 font-semibold">Target</th>
                          <th className="px-3 py-2 font-semibold">Achievement</th>
                          <th className="px-3 py-2 font-semibold">Balance</th>
                          <th className="px-3 py-2 font-semibold">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {dash.ranking.map((r, i) => (
                          <tr key={r.targetId}>
                            <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{r.label}</td>
                            <td className="px-3 py-2 text-slate-500">{TYPE_LABELS[r.type] || r.type}</td>
                            <td className="px-3 py-2 text-slate-600">{formatValue(r.targetValue, r.type)}</td>
                            <td className="px-3 py-2 text-slate-600">{formatValue(r.achievement, r.type)}</td>
                            <td className="px-3 py-2 text-slate-600">{formatValue(r.balance, r.type)}</td>
                            <td className="px-3 py-2">
                              <Badge tone={r.achievementPct >= 100 ? 'green' : r.achievementPct >= 50 ? 'amber' : 'rose'}>{pct(r.achievementPct)}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
          )}
        </div>
      )}

      {tab === 'targets' && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Search target, product, salesperson…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select className="input w-auto" value={scopeFilter} onChange={(e) => { setScopeFilter(e.target.value); setPage(1); }}>
              <option value="">All scopes</option>
              {metaInfo.scopes.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s] || s}</option>)}
            </select>
            <select className="input w-auto" value={targetTypeFilter} onChange={(e) => { setTargetTypeFilter(e.target.value); setPage(1); }}>
              <option value="">All types</option>
              {metaInfo.types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
            </select>
            <select className="input w-auto" value={periodFilter} onChange={(e) => { setPeriodFilter(e.target.value); setPage(1); }}>
              <option value="">All periods</option>
              {metaInfo.periods.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p] || p}</option>)}
            </select>
            <select className="input w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              {metaInfo.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              <option value="createdAt">Created</option>
              <option value="targetValue">Target value</option>
              <option value="startDate">Start date</option>
              <option value="endDate">End date</option>
              <option value="status">Status</option>
              <option value="achievement">Achievement</option>
              <option value="achievementPct">Achievement %</option>
            </select>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}>
              {order === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
          ) : items.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">No targets found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-3 font-semibold">Target</th>
                      <th className="px-5 py-3 font-semibold">Scope</th>
                      <th className="px-5 py-3 font-semibold">Type</th>
                      <th className="px-5 py-3 font-semibold">Period</th>
                      <th className="px-5 py-3 font-semibold">Target value</th>
                      <th className="px-5 py-3 font-semibold">Achievement</th>
                      <th className="px-5 py-3 font-semibold">Balance</th>
                      <th className="px-5 py-3 font-semibold">%</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{t.targetNo}</p>
                          <p className="text-xs text-slate-500">{t.label}</p>
                        </td>
                        <td className="px-5 py-3">{scopeBadge(t)}</td>
                        <td className="px-5 py-3 text-slate-600">{TYPE_LABELS[t.targetType] || t.targetType}</td>
                        <td className="px-5 py-3 text-slate-600">
                          {PERIOD_LABELS[t.periodType] || t.periodType}
                          <p className="text-xs text-slate-400">{formatDate(t.startDate)} → {formatDate(t.endDate)}</p>
                        </td>
                        <td className="px-5 py-3 font-medium text-slate-900">{formatValue(t.targetValue, t.targetType)}</td>
                        <td className="px-5 py-3 text-slate-600">{formatValue(t.achievement, t.targetType)}</td>
                        <td className="px-5 py-3 text-slate-600">{formatValue(t.balance, t.targetType)}</td>
                        <td className="px-5 py-3">
                          <Badge tone={t.achievementPct >= 100 ? 'green' : t.achievementPct >= 50 ? 'amber' : 'rose'}>{pct(t.achievementPct)}</Badge>
                        </td>
                        <td className="px-5 py-3"><Badge tone={STATUS_TONE[t.status] || 'slate'}>{t.status}</Badge></td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {can(user, 'targets:edit') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => openEdit(t)}>
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            {can(user, 'targets:delete') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDelete(t)}>
                                {deleting === t.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={meta} onPage={setPage} />
            </>
          )}
        </Card>
      )}

      {tab === 'scorecard' && (
        <div className="space-y-6">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="label" htmlFor="scoreUser">Salesperson</label>
                <select id="scoreUser" className="input w-56" value={scoreUser} onChange={(e) => setScoreUser(e.target.value)}>
                  <option value="">Myself</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="groupBy">Group by</label>
                <select id="groupBy" className="input w-40" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                  <option value="day">Day</option>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                  <option value="year">Year</option>
                </select>
              </div>
            </div>
          </Card>

          {scorecard ? (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                {[
                  { label: 'Sales', value: currency(scorecard.totals.sales), icon: TrendingUp },
                  { label: 'New Leads', value: count(scorecard.totals.newLeads), icon: Users },
                  { label: 'New Customers', value: count(scorecard.totals.newCustomers), icon: Users },
                  { label: 'Activities', value: count(scorecard.totals.activities), icon: BarChart3 },
                  { label: 'Collections', value: currency(scorecard.totals.collections), icon: Wallet },
                ].map((k) => (
                  <Card key={k.label} className="p-4">
                    <div className="flex items-center gap-2">
                      <k.icon className="h-4 w-4 text-brand-500" />
                      <p className="text-xs font-medium text-slate-500">{k.label}</p>
                    </div>
                    <p className="mt-2 text-xl font-semibold text-slate-900">{k.value}</p>
                  </Card>
                ))}
              </div>

              <Card className="p-5">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  {scorecard.user.name} · {scorecard.period.groupBy} series
                </h3>
                {scorecard.series.length === 0 ? (
                  <p className="text-sm text-slate-400">No activity in the selected period.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2 font-semibold">Period</th>
                          <th className="px-3 py-2 font-semibold">Sales</th>
                          <th className="px-3 py-2 font-semibold">New leads</th>
                          <th className="px-3 py-2 font-semibold">New customers</th>
                          <th className="px-3 py-2 font-semibold">Activities</th>
                          <th className="px-3 py-2 font-semibold">Conversion</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {scorecard.series.map((b) => (
                          <tr key={b.bucket}>
                            <td className="px-3 py-2 font-medium text-slate-800">{b.bucket}</td>
                            <td className="px-3 py-2 text-slate-600">{currency(b.sales)}</td>
                            <td className="px-3 py-2 text-slate-600">{count(b.newLeads)}</td>
                            <td className="px-3 py-2 text-slate-600">{count(b.newCustomers)}</td>
                            <td className="px-3 py-2 text-slate-600">{count(b.activities)}</td>
                            <td className="px-3 py-2 text-slate-600">{pct(b.conversionRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {scorecard.targets.length > 0 && (
                <Card className="p-5">
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">Assigned targets</h3>
                  <div className="space-y-2">
                    {scorecard.targets.map((t) => (
                      <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3">
                        <div>
                          <p className="font-medium text-slate-900">{t.targetNo} · {TYPE_LABELS[t.targetType] || t.targetType}</p>
                          <p className="text-xs text-slate-400">{formatDate(t.startDate)} → {formatDate(t.endDate)}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-slate-600">{formatValue(t.achievement, t.targetType)} / {formatValue(t.targetValue, t.targetType)}</span>
                          <Badge tone={t.achievementPct >= 100 ? 'green' : t.achievementPct >= 50 ? 'amber' : 'rose'}>{pct(t.achievementPct)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          ) : (
            <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
          )}
        </div>
      )}

      {tab === 'compare' && (
        <Card>
          <div className="border-b border-slate-100 p-4">
            <h3 className="text-sm font-semibold text-slate-700">Team member comparison</h3>
            <p className="text-xs text-slate-400">Members below target are highlighted.</p>
          </div>
          {!compare ? (
            <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
          ) : compare.members.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">No team members found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3 font-semibold">Member</th>
                    <th className="px-5 py-3 font-semibold">Team</th>
                    <th className="px-5 py-3 font-semibold">Territory</th>
                    <th className="px-5 py-3 font-semibold">Targets</th>
                    <th className="px-5 py-3 font-semibold">Target value</th>
                    <th className="px-5 py-3 font-semibold">Achievement</th>
                    <th className="px-5 py-3 font-semibold">Balance</th>
                    <th className="px-5 py-3 font-semibold">%</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {compare.members.map((m) => (
                    <tr key={m.userId} className={m.belowTarget ? 'bg-rose-50/40' : ''}>
                      <td className="px-5 py-3 font-medium text-slate-900">{m.name}</td>
                      <td className="px-5 py-3 text-slate-600">{m.teamName || '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{m.territory || '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{count(m.targets)}</td>
                      <td className="px-5 py-3 text-slate-600">{currency(m.targetValue)}</td>
                      <td className="px-5 py-3 text-slate-600">{currency(m.achievement)}</td>
                      <td className="px-5 py-3 text-slate-600">{currency(m.balance)}</td>
                      <td className="px-5 py-3"><Badge tone={m.achievementPct >= 100 ? 'green' : m.achievementPct >= 50 ? 'amber' : 'rose'}>{pct(m.achievementPct)}</Badge></td>
                      <td className="px-5 py-3">
                        <Badge tone={m.belowTarget ? 'rose' : 'green'}>{m.belowTarget ? 'Below target' : 'On track'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Edit target' : 'Add target'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create target'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {user?.isSuperAdmin && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="companyId">Company</label>
              <input id="companyId" type="number" className="input" value={form.companyId} onChange={update('companyId')} placeholder="Company ID" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="scope">Scope</label>
            <select id="scope" className="input" value={form.scope} onChange={update('scope')}>
              {metaInfo.scopes.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s] || s}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="targetType">Target type</label>
            <select id="targetType" className="input" value={form.targetType} onChange={update('targetType')}>
              {metaInfo.types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
            </select>
          </div>
          {form.scope === 'user' && (
            <div>
              <label className="label" htmlFor="userId">Salesperson</label>
              <select id="userId" className="input" value={form.userId} onChange={update('userId')}>
                <option value="">Select…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          {form.scope === 'team' && (
            <div>
              <label className="label" htmlFor="teamId">Team</label>
              <select id="teamId" className="input" value={form.teamId} onChange={update('teamId')}>
                <option value="">Select…</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {form.scope === 'product' && (
            <div>
              <label className="label" htmlFor="product">Product / service</label>
              <input id="product" className="input" value={form.product} onChange={update('product')} />
            </div>
          )}
          {form.scope === 'territory' && (
            <div>
              <label className="label" htmlFor="territory">Territory</label>
              <input id="territory" className="input" value={form.territory} onChange={update('territory')} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="periodType">Period type</label>
            <select id="periodType" className="input" value={form.periodType} onChange={update('periodType')}>
              {metaInfo.periods.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p] || p}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="targetValue">Target value</label>
            <input id="targetValue" type="number" min="0" step="any" className="input" value={form.targetValue} onChange={update('targetValue')} placeholder={TYPE_UNITS[form.targetType] === 'percent' ? 'e.g. 80' : 'e.g. 100000'} />
          </div>
          <div>
            <label className="label" htmlFor="startDate">Start date</label>
            <input id="startDate" type="date" className="input" value={form.startDate} onChange={update('startDate')} />
          </div>
          <div>
            <label className="label" htmlFor="endDate">End date</label>
            <input id="endDate" type="date" className="input" value={form.endDate} onChange={update('endDate')} />
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" className="input" value={form.status} onChange={update('status')}>
              {metaInfo.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {formError && <p className="text-sm text-rose-600 sm:col-span-2">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
