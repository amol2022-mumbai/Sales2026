import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Trash2,
  Send,
  Clock,
  Phone,
  CalendarClock,
  MessageSquare,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import { customersApi, usersApi, teamsApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';

const STATUS_TONE = { Active: 'green', Inactive: 'slate', Blocked: 'rose' };

const ACTIVITY_LABEL = {
  created: 'Created',
  updated: 'Updated',
  status: 'Status changed',
  assigned: 'Assignment',
  note: 'Note',
  call: 'Call',
  meeting: 'Meeting',
  follow_up: 'Follow-up',
  opportunity: 'Opportunity',
  complaint: 'Complaint',
  converted: 'Converted',
  deleted: 'Deleted',
};

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function currency(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

export default function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [types, setTypes] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);

  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [activity, setActivity] = useState({ type: 'call', description: '', scheduledAt: '' });
  const [savingActivity, setSavingActivity] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await customersApi.get(id);
      setCustomer(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    customersApi.meta().then((m) => { setTypes(m.types); setStatuses(m.statuses); }).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
    teamsApi.list({ pageSize: 100 }).then((r) => setTeams(r.data)).catch(() => {});
  }, []);

  async function submitNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      const a = await customersApi.addNote(id, note.trim());
      setCustomer((c) => ({ ...c, activities: [a, ...(c.activities || [])], notes: [a, ...(c.notes || [])] }));
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingNote(false);
    }
  }

  async function submitActivity(e) {
    e.preventDefault();
    if (!activity.description.trim()) return;
    setSavingActivity(true);
    try {
      const a = await customersApi.addActivity(id, activity.type, activity.description.trim(), activity.scheduledAt || null);
      setCustomer((c) => {
        const next = { ...c, activities: [a, ...(c.activities || [])] };
        if (a.type === 'call') next.calls = [a, ...(c.calls || [])];
        if (a.type === 'meeting') next.meetings = [a, ...(c.meetings || [])];
        if (a.type === 'follow_up') next.followUps = [a, ...(c.followUps || [])];
        if (a.type === 'complaint') next.complaints = [a, ...(c.complaints || [])];
        return next;
      });
      setActivity({ type: 'call', description: '', scheduledAt: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingActivity(false);
    }
  }

  async function changeStatus(status) {
    try {
      await customersApi.update(id, { status });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeAssignee(assignedTo) {
    try {
      await customersApi.update(id, { assignedTo: assignedTo ? Number(assignedTo) : null });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function openEdit() {
    setForm({
      name: customer.name || '',
      contactPerson: customer.contactPerson || '',
      mobile: customer.mobile || '',
      whatsapp: customer.whatsapp || '',
      email: customer.email || '',
      address: customer.address || '',
      city: customer.city || '',
      state: customer.state || '',
      gst: customer.gst || '',
      pan: customer.pan || '',
      customerType: customer.customerType || 'Company',
      status: customer.status || 'Active',
      assignedTo: customer.assignedTo ?? '',
      teamId: customer.teamId ?? '',
    });
    setFormError(null);
    setEditOpen(true);
  }

  function update(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function saveEdit(e) {
    e.preventDefault();
    setSavingEdit(true);
    setFormError(null);
    try {
      await customersApi.update(id, {
        name: form.name,
        contactPerson: form.contactPerson || null,
        mobile: form.mobile || null,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        gst: form.gst || null,
        pan: form.pan || null,
        customerType: form.customerType || 'Company',
        status: form.status || 'Active',
        assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
        teamId: form.teamId ? Number(form.teamId) : null,
      });
      setEditOpen(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this customer? The record and history are preserved but hidden.')) return;
    try {
      await customersApi.remove(id);
      navigate('/customers');
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || 'Customer not found.'}
        </div>
        <Link to="/customers" className="btn-secondary mt-4 inline-flex">Back to customers</Link>
      </div>
    );
  }

  const kpiCards = [
    { label: 'Total Sales', value: currency(customer.kpis?.totalSales) },
    { label: 'Outstanding', value: currency(customer.kpis?.outstanding) },
    { label: 'Last Purchase', value: customer.kpis?.lastPurchase ? formatDate(customer.kpis.lastPurchase) : '—' },
    { label: 'Orders', value: customer.kpis?.orderCount ?? 0 },
    { label: 'Status', value: customer.status },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/customers" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
            <ArrowLeft className="h-4 w-4" /> Back to customers
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{customer.name}</h1>
            <Badge tone={STATUS_TONE[customer.status] || 'slate'}>{customer.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {customer.customerNo}
            {customer.leadNo && <span className="ml-2 text-slate-400">· converted from {customer.leadNo}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can(user, 'customers:edit') && (
            <select className="input w-auto" value={customer.status} onChange={(e) => changeStatus(e.target.value)}>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {can(user, 'customers:edit') && (
            <button type="button" className="btn-secondary" onClick={openEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </button>
          )}
          {can(user, 'customers:delete') && (
            <button type="button" className="btn-secondary" onClick={remove}>
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {kpiCards.map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xl font-semibold text-slate-900">{k.value}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{k.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Customer details</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-400">Contact person</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.contactPerson || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Email</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Mobile</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.mobile || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">WhatsApp</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.whatsapp || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Address</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.address || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">City / State</dt>
                <dd className="text-sm font-medium text-slate-800">
                  {[customer.city, customer.state].filter(Boolean).join(', ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">GST</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.gst || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">PAN</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.pan || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Customer type</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.customerType || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Created by</dt>
                <dd className="text-sm font-medium text-slate-800">{customer.createdByName || '—'} · {formatDate(customer.createdAt)}</dd>
              </div>
            </dl>
          </Card>

          {customer.leadHistory && (
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Lead history</h2>
                <Link to={`/leads/${customer.leadHistory.id}`} className="text-xs text-brand-600 hover:underline">View lead</Link>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">{customer.leadHistory.company_name}</span>
                <Badge tone={customer.leadHistory.status === 'Won' ? 'green' : 'slate'}>{customer.leadHistory.status}</Badge>
                <span className="text-xs text-slate-400">{customer.leadHistory.lead_no}</span>
              </div>
              <ol className="mt-4 space-y-4">
                {(customer.leadHistory.activities || []).map((a) => (
                  <li key={a.id} className="relative border-l border-slate-200 pl-4">
                    <span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-brand-400" />
                    <p className="text-sm text-slate-800">{a.description}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {ACTIVITY_LABEL[a.type] || a.type} · {a.userName || 'System'} · {formatDate(a.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Activity timeline</h2>
              <Clock className="h-4 w-4 text-slate-300" />
            </div>
            <ol className="mt-4 space-y-4">
              {(customer.activities || []).map((a) => (
                <li key={a.id} className="relative border-l border-slate-200 pl-4">
                  <span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-brand-400" />
                  <p className="text-sm text-slate-800">{a.description}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {ACTIVITY_LABEL[a.type] || a.type} · {a.userName || 'System'} · {formatDate(a.createdAt)}
                  </p>
                </li>
              ))}
              {(customer.activities || []).length === 0 && (
                <li className="text-sm text-slate-500">No activity recorded yet.</li>
              )}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Assignment</h2>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-xs text-slate-400">Assigned to</p>
                {can(user, 'customers:assign') || can(user, 'customers:edit') ? (
                  <select className="input mt-1" value={customer.assignedTo ?? ''} onChange={(e) => changeAssignee(e.target.value)}>
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm font-medium text-slate-800">{customer.assignedName || 'Unassigned'}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-400">Team</p>
                <p className="text-sm font-medium text-slate-800">{customer.teamName || '—'}</p>
              </div>
            </div>
          </Card>

          {can(user, 'customers:edit') && (
            <Card className="p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Record activity</h2>
              <form onSubmit={submitActivity} className="mt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <select className="input flex-1" value={activity.type} onChange={(e) => setActivity((a) => ({ ...a, type: e.target.value }))}>
                    <option value="call">Call</option>
                    <option value="meeting">Meeting</option>
                    <option value="follow_up">Follow-up</option>
                    <option value="complaint">Complaint</option>
                  </select>
                  {activity.type === 'follow_up' && (
                    <input type="date" className="input w-auto" value={activity.scheduledAt} onChange={(e) => setActivity((a) => ({ ...a, scheduledAt: e.target.value }))} />
                  )}
                </div>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="What happened…"
                  value={activity.description}
                  onChange={(e) => setActivity((a) => ({ ...a, description: e.target.value }))}
                />
                <button type="submit" className="btn-primary w-full" disabled={savingActivity || !activity.description.trim()}>
                  {savingActivity ? <Spinner className="h-4 w-4" /> : <><Phone className="h-4 w-4" /> Record</>}
                </button>
              </form>
            </Card>
          )}

          {can(user, 'customers:edit') && (
            <Card className="p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Add note</h2>
              <form onSubmit={submitNote} className="mt-3 space-y-3">
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Add a note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button type="submit" className="btn-primary w-full" disabled={savingNote || !note.trim()}>
                  {savingNote ? <Spinner className="h-4 w-4" /> : <><Send className="h-4 w-4" /> Add note</>}
                </button>
              </form>
            </Card>
          )}

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Follow-ups</h2>
              <CalendarClock className="h-4 w-4 text-slate-300" />
            </div>
            <ol className="mt-3 space-y-3">
              {(customer.followUps || []).map((f) => (
                <li key={f.id} className="text-sm">
                  <p className="text-slate-700">{f.description}</p>
                  <p className="text-xs text-slate-400">
                    {f.metadata?.scheduledAt ? `Scheduled ${formatDate(f.metadata.scheduledAt)} · ` : ''}{formatDate(f.createdAt)}
                  </p>
                </li>
              ))}
              {(customer.followUps || []).length === 0 && (
                <li className="text-sm text-slate-500">No follow-ups scheduled.</li>
              )}
            </ol>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Complaints</h2>
              <AlertTriangle className="h-4 w-4 text-slate-300" />
            </div>
            <ol className="mt-3 space-y-3">
              {(customer.complaints || []).map((c) => (
                <li key={c.id} className="text-sm">
                  <p className="text-slate-700">{c.description}</p>
                  <p className="text-xs text-slate-400">{formatDate(c.createdAt)}</p>
                </li>
              ))}
              {(customer.complaints || []).length === 0 && (
                <li className="text-sm text-slate-500">No complaints recorded.</li>
              )}
            </ol>
          </Card>
        </div>
      </div>

      <Modal
        open={editOpen}
        title="Edit customer"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? <Spinner className="h-4 w-4" /> : 'Save changes'}
            </button>
          </>
        }
      >
        <form onSubmit={saveEdit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="edit-name">Company / name</label>
            <input id="edit-name" className="input" value={form.name} onChange={update('name')} required />
          </div>
          <div>
            <label className="label" htmlFor="edit-contactPerson">Contact person</label>
            <input id="edit-contactPerson" className="input" value={form.contactPerson} onChange={update('contactPerson')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-email">Email</label>
            <input id="edit-email" type="email" className="input" value={form.email} onChange={update('email')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-mobile">Mobile</label>
            <input id="edit-mobile" className="input" value={form.mobile} onChange={update('mobile')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-whatsapp">WhatsApp</label>
            <input id="edit-whatsapp" className="input" value={form.whatsapp} onChange={update('whatsapp')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="edit-address">Address</label>
            <input id="edit-address" className="input" value={form.address} onChange={update('address')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-city">City</label>
            <input id="edit-city" className="input" value={form.city} onChange={update('city')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-state">State</label>
            <input id="edit-state" className="input" value={form.state} onChange={update('state')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-gst">GST</label>
            <input id="edit-gst" className="input" value={form.gst} onChange={update('gst')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-pan">PAN</label>
            <input id="edit-pan" className="input" value={form.pan} onChange={update('pan')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-customerType">Customer type</label>
            <select id="edit-customerType" className="input" value={form.customerType} onChange={update('customerType')}>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="edit-status">Status</label>
            <select id="edit-status" className="input" value={form.status} onChange={update('status')}>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="edit-assignedTo">Assigned to</label>
            <select id="edit-assignedTo" className="input" value={form.assignedTo} onChange={update('assignedTo')}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="edit-teamId">Team</label>
            <select id="edit-teamId" className="input" value={form.teamId} onChange={update('teamId')}>
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          {formError && <p className="text-sm text-rose-600 sm:col-span-2">{formError}</p>}
        </form>
      </Modal>

      <p className="flex items-center gap-1 text-xs text-slate-400">
        <MessageSquare className="h-3.5 w-3.5" /> Activity history is immutable and preserved for audit.
      </p>
    </div>
  );
}
