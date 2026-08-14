import { useEffect, useMemo, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { rolesApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';

const MODULE_LABELS = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  customers: 'Customers',
  pipeline: 'Pipeline',
  followups: 'Follow-ups',
  sales: 'Sales',
  quotations: 'Quotations',
  orders: 'Orders',
  collections: 'Collections',
  products: 'Products',
  sales_team: 'Sales Team',
  targets: 'Targets',
  territories: 'Territories',
  expenses: 'Expenses',
  reports: 'Reports',
  mis: 'MIS',
  ai_assistant: 'AI Assistant',
  notifications: 'Notifications',
  audit_logs: 'Audit Logs',
  settings: 'Settings',
  users: 'Users',
  roles: 'Roles',
  companies: 'Companies',
};

export default function RolesPermissionsPage() {
  const { user } = useAuth();
  const canManage = can(user, 'roles:manage');

  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [roleMeta, setRoleMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([rolesApi.list(), rolesApi.permissions()])
      .then(([roleList, permCatalog]) => {
        if (!active) return;
        setRoles(roleList);
        setCatalog(permCatalog);
        const first = roleList[0];
        if (first) setSelectedId(first.id);
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setRoleMeta(null);
    rolesApi
      .get(selectedId)
      .then((role) => {
        if (!active) return;
        setRoleMeta(role);
        setChecked(new Set((role.permissions || []).map((p) => p.key)));
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [selectedId]);

  const grouped = useMemo(() => {
    if (!catalog) return [];
    return catalog.modules.map((m) => ({
      ...m,
      label: MODULE_LABELS[m.module] || m.module,
    }));
  }, [catalog]);

  function toggle(key) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await rolesApi.updatePermissions(selectedId, [...checked]);
      setMessage('Permissions saved.');
      const fresh = await rolesApi.get(selectedId);
      setRoleMeta(fresh);
      setChecked(new Set((fresh.permissions || []).map((p) => p.key)));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  const isSuperAdminRole = roleMeta?.isSuperAdmin;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Roles &amp; Permissions</h1>
        <p className="mt-1 text-sm text-slate-500">Configure what each role can view and do.</p>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Roles
          </div>
          <ul className="divide-y divide-slate-50">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition hover:bg-slate-50 ${
                    selectedId === r.id ? 'bg-brand-50 text-brand-700' : 'text-slate-700'
                  }`}
                >
                  <span className="font-medium">{r.name}</span>
                  {r.isSuperAdmin && <Badge tone="indigo">System</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-brand-600" />
              <h2 className="font-semibold text-slate-900">{roleMeta?.name || 'Select a role'}</h2>
            </div>
            {canManage && !isSuperAdminRole && (
              <button type="button" className="btn-primary" onClick={save} disabled={saving}>
                {saving ? <Spinner className="h-4 w-4" /> : <><Save className="h-4 w-4" /> Save</>}
              </button>
            )}
          </div>

          {isSuperAdminRole ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              The Super Admin role has unrestricted access and cannot be edited.
            </div>
          ) : (
            <div className="space-y-6 p-5">
              {grouped.map((m) => (
                <div key={m.module}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{m.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {m.permissions.map((p) => {
                      const isChecked = checked.has(p.key);
                      const disabled = !canManage;
                      return (
                        <label
                          key={p.key}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                            isChecked
                              ? 'border-brand-200 bg-brand-50 text-brand-700'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            checked={isChecked}
                            disabled={disabled}
                            onChange={() => toggle(p.key)}
                          />
                          <span className="capitalize">{p.action}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
