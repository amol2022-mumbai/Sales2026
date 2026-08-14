import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { authApi } from '../api/endpoints.js';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    jobTitle: user?.jobTitle || '',
  });
  const [profileMsg, setProfileMsg] = useState(null);
  const [profileErr, setProfileErr] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [pwErr, setPwErr] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  async function saveProfile(e) {
    e.preventDefault();
    setProfileErr(null);
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const data = await authApi.updateProfile({
        name: profile.name,
        phone: profile.phone || null,
        jobTitle: profile.jobTitle || null,
      });
      setUser(data.user);
      setProfileMsg('Profile updated successfully.');
    } catch (err) {
      setProfileErr(err.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    setSavingPw(true);
    try {
      await authApi.changePassword(pw.currentPassword, pw.newPassword);
      setPw({ currentPassword: '', newPassword: '' });
      setPwMsg('Password changed successfully.');
    } catch (err) {
      setPwErr(err.message);
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your personal details and security.</p>
      </div>

      <Card className="p-6">
        <div className="mb-6 flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white">
            {user?.name?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          <div>
            <p className="text-base font-semibold text-slate-900">{user?.name}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
            <div className="mt-1"><Badge tone="indigo">{user?.roleName}</Badge></div>
          </div>
        </div>

        <form onSubmit={saveProfile} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="jobTitle">Job title</label>
            <input id="jobTitle" className="input" value={profile.jobTitle} onChange={(e) => setProfile({ ...profile, jobTitle: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="phone">Phone</label>
            <input id="phone" className="input" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            {profileMsg && <p className="mb-2 text-sm text-emerald-600">{profileMsg}</p>}
            {profileErr && <p className="mb-2 text-sm text-rose-600">{profileErr}</p>}
            <button type="submit" disabled={savingProfile} className="btn-primary">
              {savingProfile ? <Spinner className="h-4 w-4" /> : 'Save profile'}
            </button>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">Change password</h2>
        <form onSubmit={savePassword} className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="currentPassword">Current password</label>
            <input id="currentPassword" type="password" className="input" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="newPassword">New password</label>
            <input id="newPassword" type="password" className="input" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
            <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
          </div>
          <div>
            {pwMsg && <p className="mb-2 text-sm text-emerald-600">{pwMsg}</p>}
            {pwErr && <p className="mb-2 text-sm text-rose-600">{pwErr}</p>}
            <button type="submit" disabled={savingPw} className="btn-primary">
              {savingPw ? <Spinner className="h-4 w-4" /> : 'Update password'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
