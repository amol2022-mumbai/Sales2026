import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Users, X } from 'lucide-react';
import { teamsApi, usersApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Badge from '../components/ui/Badge.jsx';

const EMPTY_FORM = { name: '', description: '', leadId: '', managerId: '' };

export default function TeamsPage() {
  const { user } = useAuth();

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [users, setUsers] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await teamsApi.list({ pageSize: 100 });
      setTeams(res.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(t) {
    setEditing(t);
    setForm({
      name: t.name || '',
      description: t.description || '',
      leadId: t.leadId || '',
      managerId: t.managerId || '',
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
        name: form.name,
        description: form.description || null,
        leadId: form.leadId ? Number(form.leadId) : null,
        managerId: form.managerId ? Number(form.managerId) : null,
      };
      if (editing) {
        await teamsApi.update(editing.id, payload);
        setMessage('Team updated.');
      } else {
        await teamsApi.create(payload);
        setMessage('Team created.');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(t) {
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await teamsApi.get(t.id);
      setDetail(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function addMember(userId) {
    try {
      const data = await teamsApi.addMembers(detail.id, [userId]);
      setDetail((d) => ({ ...d, members: data.members }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeMember(userId) {
    try {
      const data = await teamsApi.removeMember(detail.id, userId);
      setDetail((d) => ({ ...d, members: data.members }));
    } catch (e) {
      setError(e.message);
    }
  }

  const memberIds = new Set((detail?.members || []).map((m) => m.id));
  const addable = users.filter((u) => !memberIds.has(u.id));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sales Teams</h1>
          <p className="mt-1 text-sm text-slate-500">Organise teams, assign leaders and manage members.</p>
        </div>
        {can(user, 'sales_team:create') && (
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Create team
          </button>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : teams.length === 0 ? (
        <Card className="px-6 py-16 text-center text-sm text-slate-500">No teams found.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => (
            <Card key={t.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{t.name}</h3>
                  {t.description && <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>}
                </div>
                <Badge tone={t.isActive ? 'green' : 'slate'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Team leader</dt>
                  <dd className="font-medium text-slate-700">{t.leadName || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Manager</dt>
                  <dd className="font-medium text-slate-700">{t.managerName || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Members</dt>
                  <dd className="font-medium text-slate-700">{t.memberCount}</dd>
                </div>
              </dl>

              <div className="mt-4 flex items-center justify-end gap-1 border-t border-slate-100 pt-3">
                <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => openDetail(t)}>
                  <Users className="mr-1 h-3.5 w-3.5" /> Members
                </button>
                {can(user, 'sales_team:edit') && (
                  <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => openEdit(t)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Edit team' : 'Create team'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create team'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="grid grid-cols-1 gap-4">
          <div>
            <label className="label" htmlFor="teamName">Name</label>
            <input id="teamName" className="input" value={form.name} onChange={update('name')} required />
          </div>
          <div>
            <label className="label" htmlFor="teamDesc">Description</label>
            <textarea id="teamDesc" className="input" rows={2} value={form.description} onChange={update('description')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="leadId">Team leader</label>
              <select id="leadId" className="input" value={form.leadId} onChange={update('leadId')}>
                <option value="">No leader</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="managerId">Manager</label>
              <select id="managerId" className="input" value={form.managerId} onChange={update('managerId')}>
                <option value="">No manager</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>
          {formError && <p className="text-sm text-rose-600">{formError}</p>}
        </form>
      </Modal>

      <Modal open={!!detail} title={detail?.name || 'Team members'} onClose={() => setDetail(null)}>
        {detailLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="divide-y divide-slate-50">
              {(detail?.members || []).map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{m.name}</p>
                    <p className="text-xs text-slate-500">{m.email} · {m.roleName}</p>
                  </div>
                  {can(user, 'sales_team:edit') && (
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1"
                      title="Remove member"
                      onClick={() => removeMember(m.id)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
              {(detail?.members || []).length === 0 && (
                <li className="py-6 text-center text-sm text-slate-500">No members yet.</li>
              )}
            </ul>

            {can(user, 'sales_team:edit') && (
              <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
                <select className="input flex-1" defaultValue="" onChange={(e) => { if (e.target.value) addMember(Number(e.target.value)); e.target.value = ''; }}>
                  <option value="">Add member…</option>
                  {addable.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
