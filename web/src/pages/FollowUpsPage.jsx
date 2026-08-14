import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Search,
  Trash2,
  Check,
  CalendarDays,
  List,
  Clock,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { followUpsApi, usersApi, leadsApi, customersApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';

const TYPE_LABELS = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  meeting: 'Meeting',
  site_visit: 'Site Visit',
  demo: 'Demo',
  presentation: 'Presentation',
  note: 'Note',
  follow_up: 'Follow-up',
};

const STATUS_TONE = {
  Pending: 'amber',
  Completed: 'green',
  Rescheduled: 'indigo',
  Cancelled: 'slate',
  Overdue: 'rose',
};

const PRIORITY_TONE = { High: 'rose', Medium: 'amber', Low: 'slate' };

const EMPTY_FORM = {
  targetType: 'lead',
  targetId: '',
  contactPerson: '',
  activityType: 'call',
  followUpDate: '',
  followUpTime: '',
  priority: 'Medium',
  assignedTo: '',
  notes: '',
  nextAction: '',
  nextFollowUpDate: '',
};

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export default function FollowUpsPage() {
  const { user } = useAuth();

  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [dash, setDash] = useState(null);
  const [metaInfo, setMetaInfo] = useState({ types: [], priorities: [], statuses: [] });
  const [users, setUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [customers, setCustomers] = useState([]);

  const [view, setView] = useState('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sort, setSort] = useState('followUpDate');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [action, setAction] = useState(null);
  const [actionForm, setActionForm] = useState({});
  const [actionError, setActionError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [deleting, setDeleting] = useState(null);

  const [calCursor, setCalCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [calItems, setCalItems] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, pageSize: 10, sort, order };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.activityType = typeFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const res = await followUpsApi.list(params);
      setItems(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, typeFilter, priorityFilter, sort, order]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    followUpsApi.dashboard().then(setDash).catch(() => {});
    followUpsApi.meta().then(setMetaInfo).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
    leadsApi.list({ pageSize: 100 }).then((r) => setLeads(r.data)).catch(() => {});
    customersApi.list({ pageSize: 100 }).then((r) => setCustomers(r.data)).catch(() => {});
  }, []);

  const loadCalendar = useCallback(() => {
    const y = calCursor.getFullYear();
    const m = calCursor.getMonth();
    const from = `${y}-${pad(m + 1)}-01`;
    const to = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
    followUpsApi.calendar({ from, to }).then(setCalItems).catch(() => setCalItems([]));
  }, [calCursor]);

  useEffect(() => {
    if (view === 'calendar') loadCalendar();
  }, [view, loadCalendar]);

  function refresh() {
    load();
    followUpsApi.dashboard().then(setDash).catch(() => {});
    if (view === 'calendar') loadCalendar();
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

  function openEdit(f) {
    setEditing(f);
    setForm({
      targetType: f.targetType || 'lead',
      targetId: '',
      contactPerson: f.contactPerson || '',
      activityType: f.activityType || 'call',
      followUpDate: f.followUpDate || '',
      followUpTime: f.followUpTime || '',
      priority: f.priority || 'Medium',
      assignedTo: f.assignedTo ?? '',
      notes: f.notes || '',
      nextAction: f.nextAction || '',
      nextFollowUpDate: f.nextFollowUpDate || '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function buildPayload() {
    return {
      contactPerson: form.contactPerson || null,
      activityType: form.activityType,
      followUpDate: form.followUpDate,
      followUpTime: form.followUpTime || null,
      priority: form.priority,
      assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
      notes: form.notes || null,
      nextAction: form.nextAction || null,
      nextFollowUpDate: form.nextFollowUpDate || null,
    };
  }

  async function save(e) {
    e.preventDefault();
    if (!editing && !form.targetId) {
      setFormError('Select a lead or customer.');
      return;
    }
    if (!form.followUpDate) {
      setFormError('Follow-up date is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await followUpsApi.update(editing.id, buildPayload());
        setMessage('Follow-up updated.');
      } else {
        await followUpsApi.create({
          targetType: form.targetType,
          targetId: Number(form.targetId),
          contactPerson: form.contactPerson || null,
          activityType: form.activityType,
          followUpDate: form.followUpDate,
          followUpTime: form.followUpTime || null,
          priority: form.priority,
          assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
          notes: form.notes || null,
          nextAction: form.nextAction || null,
          nextFollowUpDate: form.nextFollowUpDate || null,
        });
        setMessage('Follow-up created.');
      }
      setFormOpen(false);
      refresh();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openAction(type, f) {
    setAction({ type, item: f });
    setActionForm({ notes: '', followUpDate: '', followUpTime: '', assignedTo: '' });
    setActionError(null);
  }

  async function submitAction() {
    const { type, item } = action;
    setSubmitting(true);
    setActionError(null);
    try {
      if (type === 'complete') await followUpsApi.complete(item.id, actionForm.notes);
      else if (type === 'cancel') await followUpsApi.cancel(item.id, actionForm.notes);
      else if (type === 'assign') await followUpsApi.assign(item.id, actionForm.assignedTo);
      else if (type === 'reschedule') {
        if (!actionForm.followUpDate) {
          setActionError('New date is required.');
          setSubmitting(false);
          return;
        }
        await followUpsApi.reschedule(item.id, {
          followUpDate: actionForm.followUpDate,
          followUpTime: actionForm.followUpTime || null,
          assignedTo: actionForm.assignedTo ? Number(actionForm.assignedTo) : null,
          notes: actionForm.notes || null,
        });
      }
      setAction(null);
      refresh();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete(f) {
    setDeleting(f.id);
    try {
      await followUpsApi.remove(f.id);
      setMessage('Follow-up deleted.');
      setDeleting(null);
      refresh();
    } catch (e) {
      setError(e.message);
      setDeleting(null);
    }
  }

  const kpis = useMemo(() => {
    if (!dash) return [];
    return [
      { label: 'Today', value: dash.today },
      { label: 'Upcoming', value: dash.upcoming },
      { label: 'Overdue', value: dash.overdue },
      { label: 'Completed', value: dash.completed },
      { label: 'Pending', value: dash.pending },
    ];
  }, [dash]);

  const calendarDays = useMemo(() => {
    const y = calCursor.getFullYear();
    const m = calCursor.getMonth();
    const first = new Date(y, m, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(`${y}-${pad(m + 1)}-${pad(d)}`);
    return cells;
  }, [calCursor]);

  const byDay = useMemo(() => {
    const map = {};
    for (const f of calItems) {
      if (!map[f.followUpDate]) map[f.followUpDate] = [];
      map[f.followUpDate].push(f);
    }
    return map;
  }, [calItems]);

  const monthLabel = calCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const actionTitle = {
    complete: 'Complete follow-up',
    reschedule: 'Reschedule follow-up',
    assign: 'Assign follow-up',
    cancel: 'Cancel follow-up',
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Follow-ups</h1>
          <p className="mt-1 text-sm text-slate-500">Schedule calls, meetings and activities across leads and customers.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            <button
              type="button"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${view === 'list' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setView('list')}
            >
              <List className="h-4 w-4" /> List
            </button>
            <button
              type="button"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${view === 'calendar' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setView('calendar')}
            >
              <CalendarDays className="h-4 w-4" /> Calendar
            </button>
          </div>
          {can(user, 'followups:create') && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add follow-up
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {dash && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {kpis.map((k) => (
            <Card key={k.label} className="p-4">
              <p className="text-2xl font-semibold text-slate-900">{k.value}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{k.label}</p>
            </Card>
          ))}
        </div>
      )}

      {view === 'list' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Search contact, notes, company…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select className="input w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              {metaInfo.statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className="input w-auto" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="">All types</option>
              {metaInfo.types.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
              ))}
            </select>
            <select className="input w-auto" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}>
              <option value="">All priorities</option>
              {metaInfo.priorities.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              <option value="followUpDate">Follow-up date</option>
              <option value="createdAt">Created</option>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
              <option value="activityType">Type</option>
            </select>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}>
              {order === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner className="h-8 w-8 text-brand-600" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">No follow-ups found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-3 font-semibold">When</th>
                      <th className="px-5 py-3 font-semibold">Target</th>
                      <th className="px-5 py-3 font-semibold">Type</th>
                      <th className="px-5 py-3 font-semibold">Priority</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Assigned</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items.map((f) => (
                      <tr key={f.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{formatDate(f.followUpDate)}</p>
                          <p className="text-xs text-slate-400">{f.followUpTime || '—'}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="text-slate-700">
                            {f.targetName || '—'}
                            {f.targetType === 'lead' ? (
                              <span className="ml-1 text-xs text-slate-400">Lead</span>
                            ) : (
                              <span className="ml-1 text-xs text-slate-400">Customer</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-400">{f.contactPerson || ''}</p>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{TYPE_LABELS[f.activityType] || f.activityType}</td>
                        <td className="px-5 py-3">
                          <Badge tone={PRIORITY_TONE[f.priority] || 'slate'}>{f.priority}</Badge>
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={STATUS_TONE[f.displayStatus] || 'slate'}>{f.displayStatus}</Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{f.assignedName || '—'}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {f.status === 'Pending' && can(user, 'followups:edit') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Complete" onClick={() => openAction('complete', f)}>
                                <Check className="h-4 w-4" />
                              </button>
                            )}
                            {can(user, 'followups:edit') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => openEdit(f)}>
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            {f.status === 'Pending' && can(user, 'followups:edit') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Reschedule" onClick={() => openAction('reschedule', f)}>
                                <CalendarClock className="h-4 w-4" />
                              </button>
                            )}
                            {f.status === 'Pending' && can(user, 'followups:assign') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Assign" onClick={() => openAction('assign', f)}>
                                <Clock className="h-4 w-4" />
                              </button>
                            )}
                            {f.status === 'Pending' && can(user, 'followups:edit') && (
                              <button type="button" className="btn-ghost px-2 py-1 text-xs" title="Cancel" onClick={() => openAction('cancel', f)}>
                                Cancel
                              </button>
                            )}
                            {can(user, 'followups:delete') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDelete(f)}>
                                {deleting === f.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
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
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <h2 className="text-sm font-semibold text-slate-700">{monthLabel}</h2>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary px-2.5 py-1.5" onClick={() => setCalCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setCalCursor(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })}>
                Today
              </button>
              <button type="button" className="btn-secondary px-2.5 py-1.5" onClick={() => setCalCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))} aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="px-2 py-2 text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => (
              <div key={i} className="min-h-[96px] border-b border-r border-slate-50 p-1.5 align-top">
                {day && (
                  <>
                    <p className="text-xs font-medium text-slate-500">{Number(day.slice(-2))}</p>
                    <div className="mt-1 space-y-1">
                      {(byDay[day] || []).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className="block w-full truncate rounded bg-brand-50 px-1.5 py-0.5 text-left text-xs text-brand-700 hover:bg-brand-100"
                          title={`${TYPE_LABELS[f.activityType] || f.activityType} · ${f.targetName || ''}`}
                          onClick={() => openEdit(f)}
                        >
                          {f.followUpTime ? `${f.followUpTime} ` : ''}{TYPE_LABELS[f.activityType] || f.activityType}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Edit follow-up' : 'Add follow-up'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create follow-up'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!editing && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="targetType">Target</label>
              <div className="flex gap-3">
                <select id="targetType" className="input w-auto" value={form.targetType} onChange={update('targetType')}>
                  <option value="lead">Lead</option>
                  <option value="customer">Customer</option>
                </select>
                <select id="targetId" className="input flex-1" value={form.targetId} onChange={update('targetId')} required>
                  <option value="">Select {form.targetType === 'lead' ? 'lead' : 'customer'}…</option>
                  {form.targetType === 'lead'
                    ? leads.map((l) => <option key={l.id} value={l.id}>{l.companyName}</option>)
                    : customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          )}
          <div>
            <label className="label" htmlFor="contactPerson">Contact person</label>
            <input id="contactPerson" className="input" value={form.contactPerson} onChange={update('contactPerson')} />
          </div>
          <div>
            <label className="label" htmlFor="activityType">Activity type</label>
            <select id="activityType" className="input" value={form.activityType} onChange={update('activityType')}>
              {metaInfo.types.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="followUpDate">Date</label>
            <input id="followUpDate" type="date" className="input" value={form.followUpDate} onChange={update('followUpDate')} required />
          </div>
          <div>
            <label className="label" htmlFor="followUpTime">Time</label>
            <input id="followUpTime" type="time" className="input" value={form.followUpTime} onChange={update('followUpTime')} />
          </div>
          <div>
            <label className="label" htmlFor="priority">Priority</label>
            <select id="priority" className="input" value={form.priority} onChange={update('priority')}>
              {metaInfo.priorities.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="assignedTo">Assigned to</label>
            <select id="assignedTo" className="input" value={form.assignedTo} onChange={update('assignedTo')}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" className="input" rows={2} value={form.notes} onChange={update('notes')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nextAction">Next action</label>
            <input id="nextAction" className="input" value={form.nextAction} onChange={update('nextAction')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nextFollowUpDate">Next follow-up date</label>
            <input id="nextFollowUpDate" type="date" className="input" value={form.nextFollowUpDate} onChange={update('nextFollowUpDate')} />
          </div>
          {formError && <p className="text-sm text-rose-600 sm:col-span-2">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={!!action}
        title={action ? actionTitle[action.type] : ''}
        onClose={() => setAction(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAction(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submitAction} disabled={submitting}>
              {submitting ? <Spinner className="h-4 w-4" /> : 'Confirm'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {action?.type === 'reschedule' && (
            <>
              <div>
                <label className="label" htmlFor="rDate">New date</label>
                <input id="rDate" type="date" className="input" value={actionForm.followUpDate} onChange={(e) => setActionForm((a) => ({ ...a, followUpDate: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor="rTime">New time</label>
                <input id="rTime" type="time" className="input" value={actionForm.followUpTime} onChange={(e) => setActionForm((a) => ({ ...a, followUpTime: e.target.value }))} />
              </div>
            </>
          )}
          {action?.type === 'assign' && (
            <div>
              <label className="label" htmlFor="aUser">Assign to</label>
              <select id="aUser" className="input" value={actionForm.assignedTo} onChange={(e) => setActionForm((a) => ({ ...a, assignedTo: e.target.value }))}>
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
          {(action?.type === 'complete' || action?.type === 'cancel' || action?.type === 'reschedule') && (
            <div>
              <label className="label" htmlFor="aNotes">Notes</label>
              <textarea id="aNotes" className="input" rows={2} value={actionForm.notes} onChange={(e) => setActionForm((a) => ({ ...a, notes: e.target.value }))} />
            </div>
          )}
          {actionError && <p className="text-sm text-rose-600">{actionError}</p>}
        </div>
      </Modal>
    </div>
  );
}
