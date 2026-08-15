import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Pencil,
  Search,
  Trash2,
  Upload,
  Download,
  Users,
  ChevronRight,
} from 'lucide-react';
import { leadsApi, usersApi, teamsApi } from '../api/endpoints.js';
import { getToken } from '../api/client.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';

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

const PRIORITY_TONE = { High: 'rose', Medium: 'amber', Low: 'slate' };

const EMPTY_FORM = {
  companyName: '',
  contactPerson: '',
  mobile: '',
  whatsapp: '',
  email: '',
  address: '',
  city: '',
  state: '',
  source: '',
  productService: '',
  leadValue: '',
  priority: 'Medium',
  status: 'New',
  assignedTo: '',
  teamId: '',
  nextFollowUp: '',
  notes: '',
  remarks: '',
};

function currency(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

export default function LeadsPage() {
  const { user } = useAuth();

  const [leads, setLeads] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [dash, setDash] = useState(null);
  const [metaInfo, setMetaInfo] = useState({ statuses: [], priorities: [], sources: [] });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(1);

  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);

  const [selected, setSelected] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState('csv');
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);

  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, pageSize: 10, sort, order };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const res = await leadsApi.list(params);
      setLeads(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, priorityFilter, sort, order]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    leadsApi.dashboard().then(setDash).catch(() => {});
    leadsApi.meta().then(setMetaInfo).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
    teamsApi.list({ pageSize: 100 }).then((r) => setTeams(r.data)).catch(() => {});
  }, []);

  const allSelected = leads.length > 0 && leads.every((l) => selected.includes(l.id));

  function toggleSelect(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleSelectAll() {
    setSelected(allSelected ? [] : leads.map((l) => l.id));
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

  function openEdit(l) {
    setEditing(l);
    setForm({
      companyName: l.companyName || '',
      contactPerson: l.contactPerson || '',
      mobile: l.mobile || '',
      whatsapp: l.whatsapp || '',
      email: l.email || '',
      address: l.address || '',
      city: l.city || '',
      state: l.state || '',
      source: l.source || '',
      productService: l.productService || '',
      leadValue: l.leadValue ?? '',
      priority: l.priority || 'Medium',
      status: l.status || 'New',
      assignedTo: l.assignedTo ?? '',
      teamId: l.teamId ?? '',
      nextFollowUp: l.nextFollowUp || '',
      notes: l.notes || '',
      remarks: l.remarks || '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function buildPayload() {
    return {
      companyName: form.companyName,
      contactPerson: form.contactPerson || null,
      mobile: form.mobile || null,
      whatsapp: form.whatsapp || null,
      email: form.email || null,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      source: form.source || null,
      productService: form.productService || null,
      leadValue: form.leadValue === '' ? null : Number(form.leadValue),
      priority: form.priority,
      status: form.status,
      assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
      teamId: form.teamId ? Number(form.teamId) : null,
      nextFollowUp: form.nextFollowUp || null,
      notes: form.notes || null,
      remarks: form.remarks || null,
    };
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = buildPayload();
      if (editing) {
        await leadsApi.update(editing.id, payload);
        setMessage('Lead updated.');
      } else {
        await leadsApi.create(payload);
        setMessage('Lead created.');
      }
      setFormOpen(false);
      load();
      leadsApi.dashboard().then(setDash).catch(() => {});
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runBulkStatus() {
    if (!bulkStatus) return;
    try {
      await leadsApi.bulkStatus(selected, bulkStatus);
      setMessage(`Status updated for ${selected.length} lead(s).`);
      setSelected([]);
      setBulkStatus('');
      load();
      leadsApi.dashboard().then(setDash).catch(() => {});
    } catch (e) {
      setError(e.message);
    }
  }

  async function runBulkAssign() {
    if (!bulkAssignee) return;
    try {
      await leadsApi.bulkAssign(selected, Number(bulkAssignee));
      setMessage(`Assigned ${selected.length} lead(s).`);
      setSelected([]);
      setBulkAssignee('');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function confirmDelete(l) {
    setDeleting(l);
    try {
      await leadsApi.remove(l.id);
      setMessage(`Lead ${l.leadNo} deleted.`);
      setDeleting(null);
      load();
      leadsApi.dashboard().then(setDash).catch(() => {});
    } catch (e) {
      setError(e.message);
      setDeleting(null);
    }
  }

  function onImportFile(e) {
    setImportFile(e.target.files[0] || null);
    setImportReport(null);
  }

  async function runImport() {
    if (!importFile) return;
    setImporting(true);
    setImportReport(null);
    try {
      let data;
      if (importFormat === 'csv') {
        data = await importFile.text();
      } else {
        const buf = await importFile.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        data = btoa(binary);
      }
      const report = await leadsApi.import(importFormat, data);
      setImportReport(report);
      setMessage('Import completed.');
      load();
      leadsApi.dashboard().then(setDash).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  function downloadExport(format) {
    const params = { format };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (priorityFilter) params.priority = priorityFilter;
    const url = leadsApi.exportUrl(params);
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = format === 'xlsx' ? 'leads.xlsx' : 'leads.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => setError(err.message));
  }

  const kpis = useMemo(() => {
    if (!dash) return [];
    return [
      { label: 'Total Leads', value: dash.total },
      { label: 'New', value: dash.newLeads },
      { label: 'Qualified', value: dash.qualified },
      { label: 'Won', value: dash.won },
      { label: 'Lost', value: dash.lost },
      { label: 'Conversion', value: `${dash.conversionRate}%` },
      { label: 'Unassigned', value: dash.unassigned },
      { label: 'Overdue', value: dash.overdue },
    ];
  }, [dash]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
          <p className="mt-1 text-sm text-slate-500">Track prospects, assign owners and move them through the pipeline.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user, 'leads:export') && (
            <>
              <button type="button" className="btn-secondary" onClick={() => downloadExport('csv')}>
                <Download className="h-4 w-4" /> CSV
              </button>
              <button type="button" className="btn-secondary" onClick={() => downloadExport('xlsx')}>
                <Download className="h-4 w-4" /> Excel
              </button>
            </>
          )}
          {can(user, 'leads:create') && (
            <>
              <button type="button" className="btn-secondary" onClick={() => { setImportOpen(true); setImportReport(null); setImportFile(null); }}>
                <Upload className="h-4 w-4" /> Import
              </button>
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add lead
              </button>
            </>
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
          {kpis.map((k) => (
            <Card key={k.label} className="p-4">
              <p className="text-2xl font-semibold text-slate-900">{k.value}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{k.label}</p>
            </Card>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
          <span className="text-sm font-medium text-brand-800">{selected.length} selected</span>
          {can(user, 'leads:edit') && (
            <select className="input w-auto py-1.5" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="">Set status…</option>
              {metaInfo.statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {bulkStatus && (
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={runBulkStatus}>Apply status</button>
          )}
          {can(user, 'leads:assign') && (
            <select className="input w-auto py-1.5" value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)}>
              <option value="">Assign to…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
          {bulkAssignee && (
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={runBulkAssign}>Assign</button>
          )}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search company, contact, email, mobile…"
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
          <select className="input w-auto" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}>
            <option value="">All priorities</option>
            {metaInfo.priorities.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            <option value="createdAt">Created</option>
            <option value="leadNo">Lead ID</option>
            <option value="companyName">Company</option>
            <option value="leadValue">Lead value</option>
            <option value="nextFollowUp">Next follow-up</option>
          </select>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-xs"
            onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
          >
            {order === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : leads.length === 0 ? (
          <EmptyState icon={Users} title="No leads yet" description="Leads you create will appear here. Add your first lead to start building your pipeline." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3 font-semibold">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
                    </th>
                    <th className="px-5 py-3 font-semibold">Lead</th>
                    <th className="px-5 py-3 font-semibold">Contact</th>
                    <th className="px-5 py-3 font-semibold">Source</th>
                    <th className="px-5 py-3 font-semibold">Value</th>
                    <th className="px-5 py-3 font-semibold">Priority</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Assigned</th>
                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {leads.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <input type="checkbox" checked={selected.includes(l.id)} onChange={() => toggleSelect(l.id)} aria-label="Select lead" />
                      </td>
                      <td className="px-5 py-3">
                        <Link to={`/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                          {l.companyName}
                        </Link>
                        <p className="text-xs text-slate-400">{l.leadNo}</p>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-slate-700">{l.contactPerson || '—'}</p>
                        <p className="text-xs text-slate-400">{l.email || l.mobile || ''}</p>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{l.source || '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{currency(l.leadValue)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={PRIORITY_TONE[l.priority] || 'slate'}>{l.priority}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={STATUS_TONE[l.status] || 'slate'}>{l.status}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{l.assignedName || '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/leads/${l.id}`} className="btn-ghost px-2 py-1" title="View">
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                          {can(user, 'leads:edit') && (
                            <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => openEdit(l)}>
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {can(user, 'leads:delete') && (
                            <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDelete(l)}>
                              {deleting?.id === l.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
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

      <Modal
        open={formOpen}
        title={editing ? 'Edit lead' : 'Add lead'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create lead'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="companyName">Company name</label>
            <input id="companyName" className="input" value={form.companyName} onChange={update('companyName')} required />
          </div>
          <div>
            <label className="label" htmlFor="contactPerson">Contact person</label>
            <input id="contactPerson" className="input" value={form.contactPerson} onChange={update('contactPerson')} />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={form.email} onChange={update('email')} />
          </div>
          <div>
            <label className="label" htmlFor="mobile">Mobile</label>
            <input id="mobile" className="input" value={form.mobile} onChange={update('mobile')} />
          </div>
          <div>
            <label className="label" htmlFor="whatsapp">WhatsApp</label>
            <input id="whatsapp" className="input" value={form.whatsapp} onChange={update('whatsapp')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="address">Address</label>
            <input id="address" className="input" value={form.address} onChange={update('address')} />
          </div>
          <div>
            <label className="label" htmlFor="city">City</label>
            <input id="city" className="input" value={form.city} onChange={update('city')} />
          </div>
          <div>
            <label className="label" htmlFor="state">State</label>
            <input id="state" className="input" value={form.state} onChange={update('state')} />
          </div>
          <div>
            <label className="label" htmlFor="source">Source</label>
            <select id="source" className="input" value={form.source} onChange={update('source')}>
              <option value="">Select source</option>
              {metaInfo.sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="productService">Product / service</label>
            <input id="productService" className="input" value={form.productService} onChange={update('productService')} />
          </div>
          <div>
            <label className="label" htmlFor="leadValue">Lead value</label>
            <input id="leadValue" type="number" min="0" step="any" className="input" value={form.leadValue} onChange={update('leadValue')} />
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
            <label className="label" htmlFor="status">Status</label>
            <select id="status" className="input" value={form.status} onChange={update('status')}>
              {metaInfo.statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
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
          <div>
            <label className="label" htmlFor="teamId">Team</label>
            <select id="teamId" className="input" value={form.teamId} onChange={update('teamId')}>
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nextFollowUp">Next follow-up</label>
            <input id="nextFollowUp" type="date" className="input" value={form.nextFollowUp} onChange={update('nextFollowUp')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" className="input" rows={2} value={form.notes} onChange={update('notes')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="remarks">Remarks</label>
            <textarea id="remarks" className="input" rows={2} value={form.remarks} onChange={update('remarks')} />
          </div>
          {formError && <p className="text-sm text-rose-600 sm:col-span-2">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={importOpen}
        title="Import leads"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setImportOpen(false)}>Close</button>
            <button type="button" className="btn-primary" onClick={runImport} disabled={importing || !importFile}>
              {importing ? <Spinner className="h-4 w-4" /> : 'Import'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700">Format</label>
            <select className="input w-auto" value={importFormat} onChange={(e) => { setImportFormat(e.target.value); setImportFile(null); }}>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (XLSX)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="importFile">File</label>
            <input id="importFile" type="file" accept={importFormat === 'csv' ? '.csv,text/csv' : '.xlsx'} onChange={onImportFile} />
            <p className="mt-1 text-xs text-slate-400">Include a &quot;Company&quot; column. Email/mobile + company detect duplicates.</p>
          </div>
          {importReport && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="font-medium text-slate-700">
                {importReport.imported} imported · {importReport.duplicates.length} duplicates · {importReport.errors.length} errors
              </p>
              {importReport.duplicates.length > 0 && (
                <ul className="list-inside list-disc text-xs text-amber-700">
                  {importReport.duplicates.map((d, i) => <li key={i}>Row {d.row}: {d.message}</li>)}
                </ul>
              )}
              {importReport.errors.length > 0 && (
                <ul className="list-inside list-disc text-xs text-rose-700">
                  {importReport.errors.map((err, i) => <li key={i}>Row {err.row}: {err.message}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
