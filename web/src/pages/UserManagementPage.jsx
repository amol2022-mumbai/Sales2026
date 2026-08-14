import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, KeyRound, Search, Power } from 'lucide-react';
import { usersApi, rolesApi, teamsApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';

const ASSIGNABLE = {
  business_owner: ['sales_manager', 'team_leader', 'sales_executive', 'accountant', 'viewer'],
  sales_manager: ['team_leader', 'sales_executive', 'accountant', 'viewer'],
};

const EMPTY_FORM = {
  employeeId: '',
  name: '',
  email: '',
  password: '',
  roleId: '',
  teamId: '',
  managerId: '',
  phone: '',
  territory: '',
  jobTitle: '',
  joiningDate: '',
};

const STATUS_TONE = { active: 'green', inactive: 'rose', pending: 'amber' };

export default function UserManagementPage() {
  const { user } = useAuth();

  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const [roles, setRoles] = useState([]);
  const [teams, setTeams] = useState([]);
  const [managers, setManagers] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [resetUser, setResetUser] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(null);

  const assignableRoles = user?.isSuperAdmin
    ? roles
    : roles.filter((r) => (ASSIGNABLE[user?.roleKey] || []).includes(r.key));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, pageSize: 10 };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await usersApi.list(params);
      setUsers(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    rolesApi.list().then(setRoles).catch(() => {});
    teamsApi.list({ pageSize: 100 }).then((r) => setTeams(r.data)).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setManagers(r.data)).catch(() => {});
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(u) {
    setEditing(u);
    setForm({
      employeeId: u.employeeId || '',
      name: u.name || '',
      email: u.email || '',
      password: '',
      roleId: u.roleId || '',
      teamId: u.teamId || '',
      managerId: u.managerId || '',
      phone: u.phone || '',
      territory: u.territory || '',
      jobTitle: u.jobTitle || '',
      joiningDate: u.joiningDate || '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function update(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        employeeId: form.employeeId || null,
        name: form.name,
        email: form.email,
        roleId: Number(form.roleId),
        teamId: form.teamId ? Number(form.teamId) : null,
        managerId: form.managerId ? Number(form.managerId) : null,
        phone: form.phone || null,
        territory: form.territory || null,
        jobTitle: form.jobTitle || null,
        joiningDate: form.joiningDate || null,
      };
      if (editing) {
        await usersApi.update(editing.id, payload);
        setMessage('User updated.');
      } else {
        payload.password = form.password;
        await usersApi.create(payload);
        setMessage('User created.');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(u) {
    const next = u.status === 'active' ? 'inactive' : 'active';
    try {
      await usersApi.setStatus(u.id, next);
      setMessage(next === 'active' ? 'User activated.' : 'User deactivated.');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function submitReset() {
    setResetting(true);
    setResetError(null);
    try {
      await usersApi.resetPassword(resetUser.id, resetPassword);
      setMessage(`Password reset for ${resetUser.name}.`);
      setResetUser(null);
      setResetPassword('');
    } catch (e) {
      setResetError(e.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-500">Manage team members, roles and access.</p>
        </div>
        {can(user, 'users:create') && (
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add user
          </button>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search name, email or employee ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select className="input w-auto" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.key}>{r.name}</option>
            ))}
          </select>
          <select className="input w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : users.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">No users found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3 font-semibold">User</th>
                    <th className="px-5 py-3 font-semibold">Employee ID</th>
                    <th className="px-5 py-3 font-semibold">Role</th>
                    <th className="px-5 py-3 font-semibold">Team</th>
                    <th className="px-5 py-3 font-semibold">Territory</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{u.name}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{u.employeeId || '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{u.roleName}</td>
                      <td className="px-5 py-3 text-slate-600">{u.teamName || '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{u.territory || '—'}</td>
                      <td className="px-5 py-3">
                        <Badge tone={STATUS_TONE[u.status] || 'slate'}>{u.status}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {can(user, 'users:edit') && (
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1"
                              title="Edit"
                              onClick={() => openEdit(u)}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {can(user, 'users:manage') && (
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1"
                              title="Reset password"
                              onClick={() => { setResetUser(u); setResetPassword(''); setResetError(null); }}
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                          )}
                          {(can(user, 'users:edit') || can(user, 'users:manage')) && u.id !== user?.id && (
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1"
                              title={u.status === 'active' ? 'Deactivate' : 'Activate'}
                              onClick={() => toggleStatus(u)}
                            >
                              <Power className="h-4 w-4" />
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
        title={editing ? 'Edit user' : 'Add user'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create user'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="input" value={form.name} onChange={update('name')} required />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={form.email} onChange={update('email')} required />
          </div>
          <div>
            <label className="label" htmlFor="employeeId">Employee ID</label>
            <input id="employeeId" className="input" value={form.employeeId} onChange={update('employeeId')} />
          </div>
          {!editing && (
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input" value={form.password} onChange={update('password')} required minLength={8} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="roleId">Role</label>
            <select id="roleId" className="input" value={form.roleId} onChange={update('roleId')} required>
              <option value="">Select role</option>
              {assignableRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
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
            <label className="label" htmlFor="managerId">Manager</label>
            <select id="managerId" className="input" value={form.managerId} onChange={update('managerId')}>
              <option value="">No manager</option>
              {managers
                .filter((m) => m.id !== editing?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="phone">Mobile</label>
            <input id="phone" className="input" value={form.phone} onChange={update('phone')} />
          </div>
          <div>
            <label className="label" htmlFor="jobTitle">Job title</label>
            <input id="jobTitle" className="input" value={form.jobTitle} onChange={update('jobTitle')} />
          </div>
          <div>
            <label className="label" htmlFor="territory">Territory</label>
            <input id="territory" className="input" value={form.territory} onChange={update('territory')} />
          </div>
          <div>
            <label className="label" htmlFor="joiningDate">Joining date</label>
            <input id="joiningDate" type="date" className="input" value={form.joiningDate} onChange={update('joiningDate')} />
          </div>
          {formError && <p className="text-sm text-rose-600 sm:col-span-2">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={!!resetUser}
        title={`Reset password — ${resetUser?.name || ''}`}
        onClose={() => setResetUser(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setResetUser(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submitReset} disabled={resetting || resetPassword.length < 8}>
              {resetting ? <Spinner className="h-4 w-4" /> : 'Reset password'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="label" htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            className="input"
            placeholder="At least 8 characters"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
          />
          {resetError && <p className="text-sm text-rose-600">{resetError}</p>}
        </div>
      </Modal>
    </div>
  );
}
