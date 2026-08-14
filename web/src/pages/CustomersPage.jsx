import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Pencil,
  Search,
  Trash2,
  Upload,
  Download,
  ChevronRight,
  UserPlus,
} from 'lucide-react';
import { customersApi, usersApi, teamsApi, leadsApi } from '../api/endpoints.js';
import { getToken } from '../api/client.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';

const STATUS_TONE = { Active: 'green', Inactive: 'slate', Blocked: 'rose' };

const EMPTY_FORM = {
  name: '',
  contactPerson: '',
  mobile: '',
  whatsapp: '',
  email: '',
  address: '',
  city: '',
  state: '',
  gst: '',
  pan: '',
  customerType: 'Company',
  status: 'Active',
  assignedTo: '',
  teamId: '',
};

export default function CustomersPage() {
  const { user } = useAuth();

  const [customers, setCustomers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [dash, setDash] = useState(null);
  const [metaInfo, setMetaInfo] = useState({ types: [], statuses: [] });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
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

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertLeads, setConvertLeads] = useState([]);
  const [convertLeadId, setConvertLeadId] = useState('');
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(null);

  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, pageSize: 10, sort, order };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.customerType = typeFilter;
      const res = await customersApi.list(params);
      setCustomers(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, typeFilter, sort, order]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    customersApi.dashboard().then(setDash).catch(() => {});
    customersApi.meta().then(setMetaInfo).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
    teamsApi.list({ pageSize: 100 }).then((r) => setTeams(r.data)).catch(() => {});
  }, []);

  const allSelected = customers.length > 0 && customers.every((c) => selected.includes(c.id));

  function toggleSelect(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleSelectAll() {
    setSelected(allSelected ? [] : customers.map((c) => c.id));
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

  function openEdit(c) {
    setEditing(c);
    setForm({
      name: c.name || '',
      contactPerson: c.contactPerson || '',
      mobile: c.mobile || '',
      whatsapp: c.whatsapp || '',
      email: c.email || '',
      address: c.address || '',
      city: c.city || '',
      state: c.state || '',
      gst: c.gst || '',
      pan: c.pan || '',
      customerType: c.customerType || 'Company',
      status: c.status || 'Active',
      assignedTo: c.assignedTo ?? '',
      teamId: c.teamId ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function buildPayload() {
    return {
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
    };
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = buildPayload();
      if (editing) {
        await customersApi.update(editing.id, payload);
        setMessage('Customer updated.');
      } else {
        await customersApi.create(payload);
        setMessage('Customer created.');
      }
      setFormOpen(false);
      load();
      customersApi.dashboard().then(setDash).catch(() => {});
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runBulkStatus() {
    if (!bulkStatus) return;
    try {
      await customersApi.bulkStatus(selected, bulkStatus);
      setMessage(`Status updated for ${selected.length} customer(s).`);
      setSelected([]);
      setBulkStatus('');
      load();
      customersApi.dashboard().then(setDash).catch(() => {});
    } catch (e) {
      setError(e.message);
    }
  }

  async function runBulkAssign() {
    if (!bulkAssignee) return;
    try {
      await customersApi.bulkAssign(selected, Number(bulkAssignee));
      setMessage(`Assigned ${selected.length} customer(s).`);
      setSelected([]);
      setBulkAssignee('');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function confirmDelete(c) {
    setDeleting(c);
    try {
      await customersApi.remove(c.id);
      setMessage(`Customer ${c.customerNo} deleted.`);
      setDeleting(null);
      load();
      customersApi.dashboard().then(setDash).catch(() => {});
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
      const report = await customersApi.import(importFormat, data);
      setImportReport(report);
      setMessage('Import completed.');
      load();
      customersApi.dashboard().then(setDash).catch(() => {});
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
    if (typeFilter) params.customerType = typeFilter;
    const url = customersApi.exportUrl(params);
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = format === 'xlsx' ? 'customers.xlsx' : 'customers.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => setError(err.message));
  }

  async function openConvert() {
    setConvertOpen(true);
    setConverted(null);
    setConvertLeadId('');
    setError(null);
    try {
      const [q, w] = await Promise.all([
        leadsApi.list({ pageSize: 100, status: 'Qualified' }),
        leadsApi.list({ pageSize: 100, status: 'Won' }),
      ]);
      setConvertLeads([...(q.data || []), ...(w.data || [])]);
    } catch (e) {
      setConvertLeads([]);
      setError(e.message);
    }
  }

  async function runConvert() {
    if (!convertLeadId) return;
    setConverting(true);
    try {
      const customer = await customersApi.convert({ leadId: Number(convertLeadId) });
      setConverted(customer);
      setMessage('Lead converted to customer.');
      load();
      customersApi.dashboard().then(setDash).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setConverting(false);
    }
  }

  const kpis = useMemo(() => {
    if (!dash) return [];
    return [
      { label: 'Total Customers', value: dash.total },
      { label: 'Active', value: dash.active },
      { label: 'Inactive', value: dash.inactive },
      { label: 'Blocked', value: dash.blocked },
      { label: 'Unassigned', value: dash.unassigned },
    ];
  }, [dash]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Manage accounts, contacts, tax details and assignments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user, 'customers:export') && (
            <>
              <button type="button" className="btn-secondary" onClick={() => downloadExport('csv')}>
                <Download className="h-4 w-4" /> CSV
              </button>
              <button type="button" className="btn-secondary" onClick={() => downloadExport('xlsx')}>
                <Download className="h-4 w-4" /> Excel
              </button>
            </>
          )}
          {can(user, 'customers:create') && (
            <>
              <button type="button" className="btn-secondary" onClick={() => { setImportOpen(true); setImportReport(null); setImportFile(null); }}>
                <Upload className="h-4 w-4" /> Import
              </button>
              <button type="button" className="btn-secondary" onClick={openConvert}>
                <UserPlus className="h-4 w-4" /> Convert lead
              </button>
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add customer
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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
          {can(user, 'customers:edit') && (
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
          {can(user, 'customers:assign') && (
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
              placeholder="Search name, contact, email, mobile, GST…"
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
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            <option value="createdAt">Created</option>
            <option value="customerNo">Customer ID</option>
            <option value="name">Name</option>
            <option value="contactPerson">Contact</option>
            <option value="customerType">Type</option>
            <option value="status">Status</option>
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
        ) : customers.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">No customers found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3 font-semibold">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
                    </th>
                    <th className="px-5 py-3 font-semibold">Customer</th>
                    <th className="px-5 py-3 font-semibold">Contact</th>
                    <th className="px-5 py-3 font-semibold">Type</th>
                    <th className="px-5 py-3 font-semibold">GST / PAN</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Assigned</th>
                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {customers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleSelect(c.id)} aria-label="Select customer" />
                      </td>
                      <td className="px-5 py-3">
                        <Link to={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                          {c.name}
                        </Link>
                        <p className="text-xs text-slate-400">{c.customerNo}</p>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-slate-700">{c.contactPerson || '—'}</p>
                        <p className="text-xs text-slate-400">{c.email || c.mobile || ''}</p>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{c.customerType || '—'}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {c.gst || '—'}
                        {c.pan && <span className="block text-xs text-slate-400">{c.pan}</span>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={STATUS_TONE[c.status] || 'slate'}>{c.status}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{c.assignedName || '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/customers/${c.id}`} className="btn-ghost px-2 py-1" title="View">
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                          {can(user, 'customers:edit') && (
                            <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => openEdit(c)}>
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {can(user, 'customers:delete') && (
                            <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDelete(c)}>
                              {deleting?.id === c.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
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
        title={editing ? 'Edit customer' : 'Add customer'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create customer'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Company / name</label>
            <input id="name" className="input" value={form.name} onChange={update('name')} required />
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
            <label className="label" htmlFor="gst">GST</label>
            <input id="gst" className="input" value={form.gst} onChange={update('gst')} />
          </div>
          <div>
            <label className="label" htmlFor="pan">PAN</label>
            <input id="pan" className="input" value={form.pan} onChange={update('pan')} />
          </div>
          <div>
            <label className="label" htmlFor="customerType">Customer type</label>
            <select id="customerType" className="input" value={form.customerType} onChange={update('customerType')}>
              {metaInfo.types.map((t) => (
                <option key={t} value={t}>{t}</option>
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
          {formError && <p className="text-sm text-rose-600 sm:col-span-2">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={importOpen}
        title="Import customers"
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
            <p className="mt-1 text-xs text-slate-400">Include a &quot;Company/Name&quot; column. Email/mobile/GST + name detect duplicates.</p>
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

      <Modal
        open={convertOpen}
        title="Convert lead to customer"
        onClose={() => setConvertOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConvertOpen(false)}>Close</button>
            <button type="button" className="btn-primary" onClick={runConvert} disabled={converting || !convertLeadId}>
              {converting ? <Spinner className="h-4 w-4" /> : 'Convert'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {converted ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              Converted successfully. <Link to={`/customers/${converted.id}`} className="font-medium underline">{converted.name}</Link> ({converted.customerNo})
            </div>
          ) : convertLeads.length === 0 ? (
            <p className="text-sm text-slate-500">No qualified or won leads available to convert.</p>
          ) : (
            <div>
              <label className="label" htmlFor="convertLeadId">Select lead</label>
              <select id="convertLeadId" className="input" value={convertLeadId} onChange={(e) => setConvertLeadId(e.target.value)}>
                <option value="">Choose a lead…</option>
                {convertLeads.map((l) => (
                  <option key={l.id} value={l.id}>{l.companyName} · {l.status}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-400">Converting preserves the lead&apos;s full activity history on the new customer profile.</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
