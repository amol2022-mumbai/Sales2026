import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Send, Clock, MessageSquare } from 'lucide-react';
import { leadsApi, usersApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';

const STATUS_TONE = {
  New: 'indigo',
  Contacted: 'slate',
  Interested: 'amber',
  Qualified: 'green',
  'Proposal Sent': 'indigo',
  Negotiation: 'amber',
  Won: 'green',
  Lost: 'rose',
  'Not Interested': 'slate',
  'Future Follow-up': 'slate',
};

const ACTIVITY_LABEL = {
  created: 'Created',
  updated: 'Updated',
  status: 'Status changed',
  assigned: 'Assignment',
  follow_up: 'Follow-up',
  note: 'Note',
  opportunity: 'Opportunity',
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

export default function LeadProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [statuses, setStatuses] = useState([]);
  const [users, setUsers] = useState([]);

  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await leadsApi.get(id);
      setLead(data);
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
    leadsApi.meta().then((m) => setStatuses(m.statuses)).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  async function submitNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      const activity = await leadsApi.addNote(id, note.trim());
      setLead((l) => ({ ...l, activities: [activity, ...(l.activities || [])] }));
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingNote(false);
    }
  }

  async function changeStatus(status) {
    setSavingStatus(true);
    try {
      await leadsApi.update(id, { status });
      setLead((l) => ({ ...l, status }));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingStatus(false);
    }
  }

  async function changeAssignee(assignedTo) {
    try {
      await leadsApi.update(id, { assignedTo: assignedTo ? Number(assignedTo) : null });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this lead? This is reversible only by an administrator.')) return;
    try {
      await leadsApi.remove(id);
      navigate('/leads');
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

  if (error || !lead) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || 'Lead not found.'}
        </div>
        <Link to="/leads" className="btn-secondary mt-4 inline-flex">Back to leads</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/leads" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
            <ArrowLeft className="h-4 w-4" /> Back to leads
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{lead.companyName}</h1>
            <Badge tone={STATUS_TONE[lead.status] || 'slate'}>{lead.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{lead.leadNo}</p>
        </div>
        <div className="flex items-center gap-2">
          {can(user, 'leads:edit') && (
            <select
              className="input w-auto"
              value={lead.status}
              disabled={savingStatus}
              onChange={(e) => changeStatus(e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {can(user, 'leads:delete') && (
            <button type="button" className="btn-secondary" onClick={remove}>
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Lead details</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-400">Contact person</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.contactPerson || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Email</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Mobile</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.mobile || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">WhatsApp</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.whatsapp || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Address</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.address || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">City / State</dt>
                <dd className="text-sm font-medium text-slate-800">
                  {[lead.city, lead.state].filter(Boolean).join(', ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Source</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.source || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Product / service</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.productService || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Lead value</dt>
                <dd className="text-sm font-medium text-slate-800">{currency(lead.leadValue)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Priority</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.priority || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Next follow-up</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.nextFollowUp || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Created by</dt>
                <dd className="text-sm font-medium text-slate-800">{lead.createdByName || '—'} · {formatDate(lead.createdAt)}</dd>
              </div>
              {lead.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-400">Notes</dt>
                  <dd className="text-sm text-slate-700">{lead.notes}</dd>
                </div>
              )}
              {lead.remarks && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-400">Remarks</dt>
                  <dd className="text-sm text-slate-700">{lead.remarks}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Activity timeline</h2>
              <Clock className="h-4 w-4 text-slate-300" />
            </div>
            <ol className="mt-4 space-y-4">
              {(lead.activities || []).map((a) => (
                <li key={a.id} className="relative border-l border-slate-200 pl-4">
                  <span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-brand-400" />
                  <p className="text-sm text-slate-800">{a.description}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {ACTIVITY_LABEL[a.type] || a.type} · {a.userName || 'System'} · {formatDate(a.createdAt)}
                  </p>
                </li>
              ))}
              {(lead.activities || []).length === 0 && (
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
                {can(user, 'leads:assign') || can(user, 'leads:edit') ? (
                  <select
                    className="input mt-1"
                    value={lead.assignedTo ?? ''}
                    onChange={(e) => changeAssignee(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm font-medium text-slate-800">{lead.assignedName || 'Unassigned'}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-400">Team</p>
                <p className="text-sm font-medium text-slate-800">{lead.teamName || '—'}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Follow-up history</h2>
            <ol className="mt-3 space-y-3">
              {(lead.followUpHistory || []).map((f) => (
                <li key={f.id} className="text-sm">
                  <p className="text-slate-700">{f.description}</p>
                  <p className="text-xs text-slate-400">{formatDate(f.createdAt)}</p>
                </li>
              ))}
              {(lead.followUpHistory || []).length === 0 && (
                <li className="text-sm text-slate-500">No follow-ups scheduled.</li>
              )}
            </ol>
          </Card>

          {can(user, 'leads:edit') && (
            <Card className="p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Add note</h2>
              <form onSubmit={submitNote} className="mt-3 space-y-3">
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Add a note or activity…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button type="submit" className="btn-primary w-full" disabled={savingNote || !note.trim()}>
                  {savingNote ? <Spinner className="h-4 w-4" /> : <><Send className="h-4 w-4" /> Add note</>}
                </button>
              </form>
            </Card>
          )}
        </div>
      </div>

      <p className="flex items-center gap-1 text-xs text-slate-400">
        <MessageSquare className="h-3.5 w-3.5" /> Activity history is immutable and preserved for audit.
      </p>
    </div>
  );
}
