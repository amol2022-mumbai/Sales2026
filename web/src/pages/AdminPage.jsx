import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Building2, KeyRound, CreditCard, UserPlus, Users, ShieldCheck } from 'lucide-react';
import { adminApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { platformSectionFromPath } from '../lib/platformNavigation.jsx';

const LICENSE_STATUS_TONES = { active: 'green', trial: 'indigo', expired: 'rose', suspended: 'amber' };
const CLIENT_STATUS_TONES = { active: 'green', inactive: 'slate', suspended: 'amber' };

function statusBadge(status) {
  return <Badge tone={LICENSE_STATUS_TONES[status] || 'slate'}>{status}</Badge>;
}

function currency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
}

function count(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US').format(Number(value));
}

// ---------------------------------------------------------------------------
// Platform dashboard (cross-tenant analytics)
// ---------------------------------------------------------------------------
function DashboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [companyId, setCompanyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (companyId) params.companyId = companyId;
      setData(await adminApi.dashboard(params));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner className="h-7 w-7 text-brand-600" />
      </div>
    );
  }

  if (!data) return null;

  const t = data.totals;
  const totalCompanies = t.companies || 1;

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600" htmlFor="dashCompany">Filter by company</label>
        <input
          id="dashCompany"
          type="number"
          className="input w-36"
          placeholder="Company ID"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        />
        {companyId && <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setCompanyId('')}>Clear</button>}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        {[
          { label: 'Total Tenants', value: count(t.companies) },
          { label: 'Active Tenants', value: count(t.activeCompanies) },
          { label: 'Trial Tenants', value: count(t.license?.trial) },
          { label: 'Expired Tenants', value: count(t.license?.expired) },
          { label: 'Users', value: count(t.users) },
          { label: 'Active Users', value: count(t.activeUsers) },
          { label: 'Licenses', value: count(t.licenses) },
          { label: 'Plans', value: count(t.plans) },
          { label: 'Leads', value: count(t.leads) },
          { label: 'Customers', value: count(t.customers) },
          { label: 'Revenue', value: currency(t.revenue) },
          { label: 'MRR', value: currency(t.mrr) },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xl font-semibold text-slate-900">{k.value}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{k.label}</p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-800">License lifecycle</h3>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            { label: 'Active', value: t.license?.active ?? 0, tone: 'green' },
            { label: 'Trial', value: t.license?.trial ?? 0, tone: 'indigo' },
            { label: 'Expired', value: t.license?.expired ?? 0, tone: 'rose' },
            { label: 'Suspended', value: t.license?.suspended ?? 0, tone: 'amber' },
            { label: 'Expiring soon', value: t.license?.expiringSoon ?? 0, tone: 'slate' },
          ].map((k) => (
            <div key={k.label} className="flex items-baseline gap-2">
              <p className="text-2xl font-semibold text-slate-900">{count(k.value)}</p>
              <span className="text-xs text-slate-500">{k.label}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-800">Feature usage across tenants</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.featureUsage.map((f) => (
            <div key={f.module} className="flex items-center gap-3">
              <span className="w-28 truncate text-xs text-slate-600">{f.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${Math.round((f.companies / totalCompanies) * 100)}%` }}
                />
              </div>
              <span className="w-12 text-right text-xs tabular-nums text-slate-500">{f.companies}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-800">Tenant growth (12 months)</h3>
        <div className="mt-3 flex items-end gap-1.5 overflow-x-auto">
          {data.tenantGrowth.map((g) => (
            <div key={g.month} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-slate-500">{g.companies}</span>
              <div
                className="w-full max-w-8 rounded-t-sm bg-brand-500"
                style={{ height: `${Math.max(4, Math.min(80, g.companies * 12))}px` }}
              />
              <span className="text-[10px] text-slate-400">{g.month}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">License</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Leads</th>
              <th className="px-4 py-3">Customers</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Collected</th>
              <th className="px-4 py-3">Outstanding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.companies.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-3">
                  <Badge tone={CLIENT_STATUS_TONES[c.status] || 'slate'}>{c.status}</Badge>
                </td>
                <td className="px-4 py-3">{statusBadge(c.licenseStatus)}</td>
                <td className="px-4 py-3 text-slate-600">{c.planName || '—'}</td>
                <td className="px-4 py-3 text-slate-600">
                  {count(c.userCount)}
                  {c.userLimit > 0 && (
                    <span className="text-xs text-slate-400"> / {c.userLimit}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{count(c.leadCount)}</td>
                <td className="px-4 py-3 text-slate-600">{count(c.customerCount)}</td>
                <td className="px-4 py-3 text-slate-600">{currency(c.wonRevenue)}</td>
                <td className="px-4 py-3 text-emerald-600">{currency(c.collected)}</td>
                <td className="px-4 py-3 text-rose-600">{currency(c.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ModulePicker({ options, value, onChange }) {
  const selected = value ?? [];
  function toggle(key) {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else onChange([...selected, key]);
  }
  return (
    <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3">
      {options.map((m) => (
        <label key={m.key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={selected.includes(m.key)}
            onChange={() => toggle(m.key)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          {m.label}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
function ClientsTab() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [inviting, setInviting] = useState(null);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '' });
  const [inviteResult, setInviteResult] = useState(null);
  const [sendingInvite, setSendingInvite] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.clients.list({ pageSize: 100 });
      setClients(res.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing({ id: null });
    setForm({ name: '', email: '', domain: '', brandColor: '#4f46e5', status: 'active' });
  }

  function openEdit(c) {
    setEditing({ id: c.id });
    setForm({
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      website: c.website || '',
      domain: c.domain || '',
      industry: c.industry || '',
      brandColor: c.brandColor || '#4f46e5',
      logoUrl: c.logoUrl || '',
      faviconUrl: c.faviconUrl || '',
      status: c.status || 'active',
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (editing.id) await adminApi.clients.update(editing.id, form);
      else await adminApi.clients.create(form);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openInvite(c) {
    setInviting(c);
    setInviteForm({ name: '', email: '' });
    setInviteResult(null);
  }

  async function sendInvite() {
    setSendingInvite(true);
    setError(null);
    setInviteResult(null);
    try {
      const res = await adminApi.clients.inviteAdmin(inviting.id, inviteForm);
      setInviteResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setSendingInvite(false);
    }
  }

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const updateInvite = (k) => (e) => setInviteForm((f) => ({ ...f, [k]: e.target.value }));

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner className="h-7 w-7 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{clients.length} client(s)</p>
        <button type="button" className="btn-primary" onClick={openCreate}>
          <Plus className="h-4 w-4" /> New client
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">License</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-3 text-slate-500">{c.domain || '—'}</td>
                <td className="px-4 py-3">
                  <Badge tone={CLIENT_STATUS_TONES[c.status] || 'slate'}>{c.status}</Badge>
                </td>
                <td className="px-4 py-3">{statusBadge(c.licenseStatus || c.license?.status || 'active')}</td>
                <td className="px-4 py-3 text-slate-600">{c.userCount ?? 0}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="text-sm font-medium text-brand-600 hover:text-brand-700" onClick={() => openInvite(c)}>
                    <UserPlus className="mr-1 inline h-4 w-4" />Invite admin
                  </button>
                  <button type="button" className="ml-3 text-sm font-medium text-brand-600 hover:text-brand-700" onClick={() => openEdit(c)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={!!editing} title={editing?.id ? 'Edit client' : 'New client'} onClose={() => setEditing(null)}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Name</label>
            <input className="input" value={form.name || ''} onChange={update('name')} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={form.email || ''} onChange={update('email')} />
          </div>
          <div>
            <label className="label">Domain</label>
            <input className="input" placeholder="app.client.com" value={form.domain || ''} onChange={update('domain')} />
          </div>
          <div>
            <label className="label">Industry</label>
            <input className="input" placeholder="e.g. Manufacturing" value={form.industry || ''} onChange={update('industry')} />
          </div>
          <div>
            <label className="label">Brand colour</label>
            <input type="color" className="h-10 w-full cursor-pointer rounded-lg border border-slate-300 p-1" value={form.brandColor || '#4f46e5'} onChange={update('brandColor')} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status || 'active'} onChange={update('status')}>
              {['active', 'inactive', 'suspended'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Logo URL</label>
            <input className="input" value={form.logoUrl || ''} onChange={update('logoUrl')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Favicon URL</label>
            <input className="input" value={form.faviconUrl || ''} onChange={update('faviconUrl')} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {saving ? <Spinner className="h-4 w-4" /> : 'Save'}
          </button>
        </div>
      </Modal>

      <Modal open={!!inviting} title={`Invite admin — ${inviting?.name || ''}`} onClose={() => setInviting(null)}>
        <div className="space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" value={inviteForm.name} onChange={updateInvite('name')} placeholder="Jane Doe" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={inviteForm.email} onChange={updateInvite('email')} placeholder="jane@company.com" />
          </div>

          {inviteResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <p className="font-medium">Invitation created</p>
              <p className="mt-1 break-all text-xs">Share this link with {inviteResult.email}:</p>
              <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{window.location.origin}/accept-invite?token={inviteResult.invitationToken}</code>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => setInviting(null)}>Close</button>
          <button type="button" className="btn-primary" disabled={sendingInvite || !inviteForm.name || !inviteForm.email} onClick={sendInvite}>
            {sendingInvite ? <Spinner className="h-4 w-4" /> : 'Send invitation'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
function PlansTab() {
  const [plans, setPlans] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pl, mo] = await Promise.all([adminApi.plans.list(), adminApi.modules()]);
      setPlans(pl);
      setModules(mo.modules || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing({ id: null });
    setForm({ key: '', name: '', description: '', userLimit: -1, priceMonthly: 0, isActive: true, modules: null });
  }

  function openEdit(p) {
    setEditing({ id: p.id });
    setForm({
      name: p.name || '',
      description: p.description || '',
      userLimit: p.userLimit ?? -1,
      priceMonthly: p.priceMonthly ?? 0,
      isActive: p.isActive !== false,
      modules: p.modules ?? null,
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        userLimit: Number(form.userLimit),
        priceMonthly: Number(form.priceMonthly),
      };
      if (editing.id) await adminApi.plans.update(editing.id, payload);
      else await adminApi.plans.create(payload);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner className="h-7 w-7 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{plans.length} plan(s)</p>
        <button type="button" className="btn-primary" onClick={openCreate}>
          <Plus className="h-4 w-4" /> New plan
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">{p.name}</h3>
              <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-400">{p.key}</p>
            <p className="mt-3 text-2xl font-bold text-slate-900">${p.priceMonthly}<span className="text-sm font-normal text-slate-400">/mo</span></p>
            <p className="mt-2 text-sm text-slate-500">{p.userLimit < 0 ? 'Unlimited users' : `${p.userLimit} users`}</p>
            <p className="mt-1 text-xs text-slate-400">{p.modules == null ? 'All modules' : `${p.modules.length} modules`}</p>
            {p.description && <p className="mt-2 text-xs text-slate-500">{p.description}</p>}
            <button type="button" className="mt-3 text-sm font-medium text-brand-600 hover:text-brand-700" onClick={() => openEdit(p)}>
              Edit
            </button>
          </Card>
        ))}
      </div>

      <Modal open={!!editing} title={editing?.id ? 'Edit plan' : 'New plan'} onClose={() => setEditing(null)}>
        <div className="space-y-4">
          {!editing?.id && (
            <div>
              <label className="label">Key</label>
              <input className="input" placeholder="basic" value={form.key || ''} onChange={update('key')} />
            </div>
          )}
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name || ''} onChange={update('name')} />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description || ''} onChange={update('description')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">User limit (-1 = unlimited)</label>
              <input type="number" className="input" value={form.userLimit} onChange={update('userLimit')} />
            </div>
            <div>
              <label className="label">Price / month</label>
              <input type="number" className="input" value={form.priceMonthly} onChange={update('priceMonthly')} />
            </div>
          </div>
          <div>
            <label className="label">Modules (empty = all)</label>
            <ModulePicker
              options={modules}
              value={form.modules ?? []}
              onChange={(mods) => setForm((f) => ({ ...f, modules: mods.length ? mods : null }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={form.isActive !== false} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Active
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {saving ? <Spinner className="h-4 w-4" /> : 'Save'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------
function LicensesTab() {
  const [licenses, setLicenses] = useState([]);
  const [plans, setPlans] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [li, pl, mo] = await Promise.all([adminApi.licenses.list(), adminApi.plans.list(), adminApi.modules()]);
      setLicenses(li);
      setPlans(pl);
      setModules(mo.modules || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit(l) {
    setEditing({ id: l.companyId });
    setForm({
      planId: l.planId ?? '',
      status: l.status || 'active',
      startsAt: l.startsAt || '',
      expiresAt: l.expiresAt || '',
      userLimit: l.userLimit ?? '',
      modules: l.modules ?? [],
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        planId: form.planId ? Number(form.planId) : null,
        status: form.status,
        startsAt: form.startsAt || null,
        expiresAt: form.expiresAt || null,
        userLimit: form.userLimit === '' ? null : Number(form.userLimit),
        modules: form.modules,
      };
      await adminApi.licenses.upsert(editing.id, payload);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner className="h-7 w-7 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {licenses.map((l) => (
              <tr key={l.companyId} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{l.companyName || `Client ${l.companyId}`}</td>
                <td className="px-4 py-3 text-slate-500">{l.planName || '—'}</td>
                <td className="px-4 py-3">{statusBadge(l.status)}</td>
                <td className="px-4 py-3 text-slate-500">{l.expiresAt || 'Never'}</td>
                <td className="px-4 py-3 text-slate-600">{l.userLimit == null || l.userLimit < 0 ? 'Unlimited' : l.userLimit}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="text-sm font-medium text-brand-600 hover:text-brand-700" onClick={() => openEdit(l)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={!!editing} title="Edit license" onClose={() => setEditing(null)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Plan</label>
              <select className="input" value={form.planId} onChange={update('planId')}>
                <option value="">— No plan —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={update('status')}>
                {['active', 'trial', 'expired', 'suspended'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Starts at</label>
              <input type="date" className="input" value={form.startsAt || ''} onChange={update('startsAt')} />
            </div>
            <div>
              <label className="label">Expires at</label>
              <input type="date" className="input" value={form.expiresAt || ''} onChange={update('expiresAt')} />
            </div>
          </div>
          <div>
            <label className="label">User limit (blank = inherit plan)</label>
            <input type="number" className="input" value={form.userLimit} onChange={update('userLimit')} />
          </div>
          <div>
            <label className="label">Modules (blank = inherit plan)</label>
            <ModulePicker
              options={modules}
              value={form.modules ?? []}
              onChange={(mods) => setForm((f) => ({ ...f, modules: mods }))}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {saving ? <Spinner className="h-4 w-4" /> : 'Save'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder platform sections (no new business features implemented)
// ---------------------------------------------------------------------------
const PLACEHOLDER_SECTIONS = {
  subscriptions: {
    title: 'Subscriptions',
    description: 'Subscription lifecycle, renewals and billing records across all tenants will appear here.',
  },
  tenant_users: {
    title: 'Tenant Users',
    description: 'Cross-tenant user directory with role, status and last active details will appear here.',
  },
  entitlements: {
    title: 'Feature Entitlements',
    description: 'Per-tenant feature and module entitlements will appear here.',
  },
  usage: {
    title: 'Usage & Limits',
    description: 'Tenant-level usage consumption against plan limits will appear here.',
  },
  analytics: {
    title: 'Tenant Analytics',
    description: 'Platform-wide tenant analytics and benchmarks will appear here.',
  },
  reports: {
    title: 'Platform Reports',
    description: 'Aggregated platform reports and exports will appear here.',
  },
  audit: {
    title: 'Audit & Security',
    description: 'Audit logs, sign-in activity and security events will appear here.',
  },
  settings: {
    title: 'System Settings',
    description: 'Platform-level system settings and configuration will appear here.',
  },
};

function PlaceholderSection({ sectionKey }) {
  const meta = PLACEHOLDER_SECTIONS[sectionKey];
  return (
    <Card className="flex flex-col items-start gap-4 p-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
        <ShieldCheck className="h-6 w-6 text-slate-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{meta.title}</h2>
        <p className="mt-1 max-w-xl text-sm text-slate-500">{meta.description}</p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AdminPage() {
  const { user } = useAuth();
  const location = useLocation();
  const section = platformSectionFromPath(location.pathname);

  if (!user?.isSuperAdmin) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        You do not have access to this area.
      </div>
    );
  }

  const headings = {
    platform_dashboard: { title: 'Platform Dashboard', description: 'Overview of tenants, users, plans, licenses and usage across the platform.' },
    companies: { title: 'Companies / Tenants', description: 'Manage white-label clients, their admins and tenant status.' },
    plans: { title: 'Plans', description: 'Define subscription plans, pricing and included modules.' },
    licenses: { title: 'Licenses', description: 'Issue and manage tenant licenses, status and limits.' },
  };

  const heading = headings[section];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {heading && (
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{heading.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{heading.description}</p>
        </div>
      )}

      {section === 'platform_dashboard' && <DashboardTab />}
      {section === 'companies' && <ClientsTab />}
      {section === 'plans' && <PlansTab />}
      {section === 'licenses' && <LicensesTab />}
      {PLACEHOLDER_SECTIONS[section] && <PlaceholderSection sectionKey={section} />}
    </div>
  );
}
