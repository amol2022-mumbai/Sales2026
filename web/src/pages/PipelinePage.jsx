import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Pencil,
  Search,
  Trash2,
  List,
  Columns,
  StickyNote,
  History,
  GripVertical,
} from 'lucide-react';
import { pipelineApi, usersApi, leadsApi, customersApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';

const STAGE_TONE = {
  New: 'indigo',
  Contacted: 'slate',
  Qualified: 'amber',
  Proposal: 'sky',
  Negotiation: 'violet',
  Won: 'green',
  Lost: 'rose',
};

const PRIORITY_TONE = { High: 'rose', Medium: 'amber', Low: 'slate' };

const EMPTY_FORM = {
  targetType: 'lead',
  targetId: '',
  contactPerson: '',
  productService: '',
  dealValue: '',
  probability: '',
  expectedCloseDate: '',
  assignedTo: '',
  stage: 'New',
  priority: 'Medium',
  notes: '',
  nextAction: '',
};

function currency(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PipelinePage() {
  const { user } = useAuth();

  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [dash, setDash] = useState(null);
  const [board, setBoard] = useState(null);
  const [metaInfo, setMetaInfo] = useState({ stages: [], priorities: [] });
  const [users, setUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [customers, setCustomers] = useState([]);

  const [view, setView] = useState('board');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [noteOpen, setNoteOpen] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState(null);

  const [deleting, setDeleting] = useState(null);
  const [dragId, setDragId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, pageSize: 10, sort, order };
      if (search) params.search = search;
      if (stageFilter) params.stage = stageFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const res = await pipelineApi.list(params);
      setItems(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, stageFilter, priorityFilter, sort, order]);

  const loadBoard = useCallback(async () => {
    try {
      const params = {};
      if (search) params.search = search;
      const res = await pipelineApi.board(params);
      setBoard(res);
    } catch (e) {
      setError(e.message);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    pipelineApi.dashboard().then(setDash).catch(() => {});
    pipelineApi.meta().then(setMetaInfo).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
    leadsApi.list({ pageSize: 100 }).then((r) => setLeads(r.data)).catch(() => {});
    customersApi.list({ pageSize: 100 }).then((r) => setCustomers(r.data)).catch(() => {});
  }, []);

  function refresh() {
    load();
    loadBoard();
    pipelineApi.dashboard().then(setDash).catch(() => {});
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

  function openEdit(o) {
    setEditing(o);
    setForm({
      targetType: o.targetType || 'lead',
      targetId: '',
      contactPerson: o.contactPerson || '',
      productService: o.productService || '',
      dealValue: o.dealValue ?? '',
      probability: o.probability ?? '',
      expectedCloseDate: o.expectedCloseDate || '',
      assignedTo: o.assignedTo ?? '',
      stage: o.stage || 'New',
      priority: o.priority || 'Medium',
      notes: o.notes || '',
      nextAction: o.nextAction || '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function buildPayload() {
    return {
      contactPerson: form.contactPerson || null,
      productService: form.productService || null,
      dealValue: form.dealValue === '' ? null : Number(form.dealValue),
      probability: form.probability === '' ? null : Number(form.probability),
      expectedCloseDate: form.expectedCloseDate || null,
      assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
      priority: form.priority,
      notes: form.notes || null,
      nextAction: form.nextAction || null,
    };
  }

  async function save(e) {
    e.preventDefault();
    if (!editing && !form.targetId) {
      setFormError('Select a lead or customer.');
      return;
    }
    if (!editing && !form.productService) {
      setFormError('Product/service is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await pipelineApi.update(editing.id, buildPayload());
        setMessage('Opportunity updated.');
      } else {
        await pipelineApi.create({
          targetType: form.targetType,
          targetId: Number(form.targetId),
          contactPerson: form.contactPerson || null,
          productService: form.productService || null,
          dealValue: form.dealValue === '' ? null : Number(form.dealValue),
          probability: form.probability === '' ? null : Number(form.probability),
          expectedCloseDate: form.expectedCloseDate || null,
          assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
          stage: form.stage,
          priority: form.priority,
          notes: form.notes || null,
          nextAction: form.nextAction || null,
        });
        setMessage('Opportunity created.');
      }
      setFormOpen(false);
      refresh();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(o) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await pipelineApi.get(o.id);
      setDetail(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function moveStage(o, stage) {
    if (stage === o.stage) return;
    try {
      await pipelineApi.moveStage(o.id, stage);
      setMessage(`Moved to ${stage}.`);
      if (detail && detail.id === o.id) setDetail(null);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  function openNote(o) {
    setNoteOpen(o);
    setNoteText('');
    setNoteError(null);
  }

  async function submitNote() {
    if (!noteText.trim()) {
      setNoteError('Note is required.');
      return;
    }
    setNoteSaving(true);
    setNoteError(null);
    try {
      await pipelineApi.addNote(noteOpen.id, noteText.trim());
      setMessage('Note added.');
      setNoteOpen(null);
      if (detail && detail.id === noteOpen.id) openDetail(noteOpen);
    } catch (err) {
      setNoteError(err.message);
    } finally {
      setNoteSaving(false);
    }
  }

  async function confirmDelete(o) {
    setDeleting(o.id);
    try {
      await pipelineApi.remove(o.id);
      setMessage('Opportunity deleted.');
      setDeleting(null);
      refresh();
    } catch (e) {
      setError(e.message);
      setDeleting(null);
    }
  }

  function onDrop(stage) {
    if (dragId) {
      const o = findItem(dragId);
      if (o) moveStage(o, stage);
    }
    setDragId(null);
  }

  function findItem(id) {
    for (const col of board?.columns || []) {
      const found = col.items.find((i) => i.id === id);
      if (found) return found;
    }
    return null;
  }

  const kpis = useMemo(() => {
    if (!dash) return [];
    return [
      { label: 'Opportunities', value: dash.total, hint: 'Total deals in pipeline' },
      { label: 'Pipeline Value', value: currency(dash.pipelineValue), hint: 'Open deals value' },
      { label: 'Weighted Pipeline', value: currency(dash.weightedValue), hint: 'Value × probability' },
      { label: 'Expected Close', value: currency(dash.expectedCloseValue), hint: 'Closing this period' },
      { label: 'Won Value', value: currency(dash.wonValue), hint: 'Closed won' },
      { label: 'Lost Value', value: currency(dash.lostValue), hint: 'Closed lost' },
      { label: 'Conversion Rate', value: `${dash.conversionRate}%`, hint: 'Won ÷ closed' },
    ];
  }, [dash]);

  const targetLink = (o) => {
    if (o.targetType === 'lead') return `/leads/${o.leadId}`;
    if (o.targetType === 'customer') return `/customers/${o.customerId}`;
    return null;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pipeline</h1>
          <p className="mt-1 text-sm text-slate-500">Track opportunities from lead to won deal.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            <button
              type="button"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${view === 'board' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setView('board')}
            >
              <Columns className="h-4 w-4" /> Board
            </button>
            <button
              type="button"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${view === 'list' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setView('list')}
            >
              <List className="h-4 w-4" /> List
            </button>
          </div>
          {can(user, 'pipeline:create') && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add opportunity
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
          {kpis.map((k) => (
            <Card key={k.label} className="p-4">
              <p className="text-xl font-semibold text-slate-900">{k.value}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{k.label}</p>
            </Card>
          ))}
        </div>
      )}

      {view === 'board' ? (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-4" style={{ minWidth: '1080px' }}>
            {(board?.columns || []).map((col) => (
              <div
                key={col.stage}
                className="w-60 flex-shrink-0 rounded-xl border border-slate-200 bg-slate-50"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(col.stage)}
              >
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={STAGE_TONE[col.stage] || 'slate'}>{col.stage}</Badge>
                    <span className="text-xs text-slate-400">{col.count}</span>
                  </div>
                </div>
                <div className="space-y-2 px-3 py-3">
                  {col.items.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      draggable
                      onDragStart={() => setDragId(o.id)}
                      onDragEnd={() => setDragId(null)}
                      className="block w-full cursor-grab rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:shadow"
                      onClick={() => openDetail(o)}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-semibold text-slate-500">{o.opportunityNo}</p>
                        <GripVertical className="h-4 w-4 text-slate-300" />
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-slate-900">{o.productService}</p>
                      <p className="truncate text-xs text-slate-500">{o.targetName || '—'}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-900">{currency(o.dealValue)}</span>
                        <span className="text-xs text-slate-400">{o.probability ?? 0}%</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Badge tone={PRIORITY_TONE[o.priority] || 'slate'}>{o.priority}</Badge>
                        <span className="text-xs text-slate-400">{formatDate(o.expectedCloseDate)}</span>
                      </div>
                    </button>
                  ))}
                  {col.items.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                      Drop here
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Search opportunity, product, contact…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select className="input w-auto" value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}>
              <option value="">All stages</option>
              {metaInfo.stages.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className="input w-auto" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}>
              <option value="">All priorities</option>
              {metaInfo.priorities.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              <option value="createdAt">Created</option>
              <option value="opportunityNo">Opportunity no.</option>
              <option value="dealValue">Deal value</option>
              <option value="probability">Probability</option>
              <option value="expectedCloseDate">Expected close</option>
              <option value="stage">Stage</option>
              <option value="priority">Priority</option>
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
            <div className="px-6 py-16 text-center text-sm text-slate-500">No opportunities found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-3 font-semibold">Opportunity</th>
                      <th className="px-5 py-3 font-semibold">Target</th>
                      <th className="px-5 py-3 font-semibold">Stage</th>
                      <th className="px-5 py-3 font-semibold">Deal value</th>
                      <th className="px-5 py-3 font-semibold">Probability</th>
                      <th className="px-5 py-3 font-semibold">Weighted</th>
                      <th className="px-5 py-3 font-semibold">Expected close</th>
                      <th className="px-5 py-3 font-semibold">Assigned</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => openDetail(o)}>
                            {o.opportunityNo}
                          </button>
                          <p className="text-slate-600">{o.productService || '—'}</p>
                        </td>
                        <td className="px-5 py-3">
                          {targetLink(o) ? (
                            <Link to={targetLink(o)} className="text-slate-700 hover:underline">
                              {o.targetName || '—'}
                            </Link>
                          ) : (
                            <span className="text-slate-700">{o.targetName || '—'}</span>
                          )}
                          <p className="text-xs text-slate-400">{o.contactPerson || ''}</p>
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={STAGE_TONE[o.stage] || 'slate'}>{o.stage}</Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{currency(o.dealValue)}</td>
                        <td className="px-5 py-3 text-slate-600">{o.probability != null ? `${o.probability}%` : '—'}</td>
                        <td className="px-5 py-3 font-medium text-slate-900">{currency(o.weightedValue)}</td>
                        <td className="px-5 py-3 text-slate-600">{formatDate(o.expectedCloseDate)}</td>
                        <td className="px-5 py-3 text-slate-600">{o.assignedName || '—'}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" className="btn-ghost px-2 py-1" title="History" onClick={() => openDetail(o)}>
                              <History className="h-4 w-4" />
                            </button>
                            {can(user, 'pipeline:edit') && (
                              <>
                                <button type="button" className="btn-ghost px-2 py-1" title="Add note" onClick={() => openNote(o)}>
                                  <StickyNote className="h-4 w-4" />
                                </button>
                                <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => openEdit(o)}>
                                  <Pencil className="h-4 w-4" />
                                </button>
                              </>
                            )}
                            {can(user, 'pipeline:delete') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDelete(o)}>
                                {deleting === o.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
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

      <Modal
        open={formOpen}
        title={editing ? 'Edit opportunity' : 'Add opportunity'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create opportunity'}
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
            <label className="label" htmlFor="productService">Product / service</label>
            <input id="productService" className="input" value={form.productService} onChange={update('productService')} required />
          </div>
          <div>
            <label className="label" htmlFor="contactPerson">Contact person</label>
            <input id="contactPerson" className="input" value={form.contactPerson} onChange={update('contactPerson')} />
          </div>
          <div>
            <label className="label" htmlFor="dealValue">Deal value</label>
            <input id="dealValue" type="number" min="0" step="any" className="input" value={form.dealValue} onChange={update('dealValue')} />
          </div>
          <div>
            <label className="label" htmlFor="probability">Probability (%)</label>
            <input id="probability" type="number" min="0" max="100" step="1" className="input" value={form.probability} onChange={update('probability')} />
          </div>
          <div>
            <label className="label" htmlFor="expectedCloseDate">Expected close date</label>
            <input id="expectedCloseDate" type="date" className="input" value={form.expectedCloseDate} onChange={update('expectedCloseDate')} />
          </div>
          <div>
            <label className="label" htmlFor="stage">Stage</label>
            <select id="stage" className="input" value={form.stage} onChange={update('stage')}>
              {metaInfo.stages.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
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
            <label className="label" htmlFor="nextAction">Next action</label>
            <input id="nextAction" className="input" value={form.nextAction} onChange={update('nextAction')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" className="input" rows={2} value={form.notes} onChange={update('notes')} />
          </div>
          {formError && <p className="text-sm text-rose-600 sm:col-span-2">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={!!noteOpen}
        title={noteOpen ? `Add note · ${noteOpen.opportunityNo}` : 'Add note'}
        onClose={() => setNoteOpen(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setNoteOpen(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submitNote} disabled={noteSaving}>
              {noteSaving ? <Spinner className="h-4 w-4" /> : 'Add note'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="noteText">Note</label>
            <textarea id="noteText" className="input" rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          </div>
          {noteError && <p className="text-sm text-rose-600">{noteError}</p>}
        </div>
      </Modal>

      <Modal
        open={!!detail || detailLoading}
        title={detail ? `${detail.opportunityNo} · ${detail.productService || 'Opportunity'}` : 'Opportunity'}
        onClose={() => setDetail(null)}
      >
        {detailLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-slate-400">Stage</p>
                <Badge tone={STAGE_TONE[detail.stage] || 'slate'}>{detail.stage}</Badge>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Priority</p>
                <Badge tone={PRIORITY_TONE[detail.priority] || 'slate'}>{detail.priority}</Badge>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Deal value</p>
                <p className="font-semibold text-slate-900">{currency(detail.dealValue)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Probability</p>
                <p className="font-semibold text-slate-900">{detail.probability != null ? `${detail.probability}%` : '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Weighted</p>
                <p className="font-semibold text-slate-900">{currency(detail.weightedValue)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Expected close</p>
                <p className="font-semibold text-slate-900">{formatDate(detail.expectedCloseDate)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Target</p>
                {targetLink(detail) ? (
                  <Link to={targetLink(detail)} className="font-medium text-brand-700 hover:underline">
                    {detail.targetName || '—'}
                  </Link>
                ) : (
                  <p className="font-medium text-slate-900">{detail.targetName || '—'}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Assigned</p>
                <p className="font-medium text-slate-900">{detail.assignedName || '—'}</p>
              </div>
            </div>

            {can(user, 'pipeline:edit') && (
              <div>
                <label className="label" htmlFor="moveStage">Move stage</label>
                <select
                  id="moveStage"
                  className="input"
                  value={detail.stage}
                  onChange={(e) => moveStage(detail, e.target.value)}
                >
                  {metaInfo.stages.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

            {detail.notes && (
              <div>
                <p className="text-xs font-medium text-slate-400">Notes</p>
                <p className="text-sm text-slate-700">{detail.notes}</p>
              </div>
            )}
            {detail.nextAction && (
              <div>
                <p className="text-xs font-medium text-slate-400">Next action</p>
                <p className="text-sm text-slate-700">{detail.nextAction}</p>
              </div>
            )}

            {detail.followUps.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-400">Follow-ups</p>
                <ul className="space-y-1.5">
                  {detail.followUps.map((f) => (
                    <li key={f.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="capitalize text-slate-700">{f.activityType}</span>
                      <span className="text-xs text-slate-400">
                        {formatDate(f.followUpDate)} · {f.followUpTime || '—'} · {f.assignedName || '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-medium text-slate-400">Activity timeline</p>
              {detail.activities.length === 0 ? (
                <p className="text-sm text-slate-400">No activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.activities.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-sm">
                      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand-400" />
                      <div>
                        <p className="text-slate-700">{a.description}</p>
                        <p className="text-xs text-slate-400">
                          {a.userName || 'System'} · {new Date(a.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
