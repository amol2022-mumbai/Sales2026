import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandContext.jsx';
import Logo from '../components/ui/Logo.jsx';
import Spinner from '../components/ui/Spinner.jsx';

export default function ChangePasswordPage() {
  const { user, setPassword } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (form.newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await setPassword(form.newPassword);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to update password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
            <ShieldCheck className="h-6 w-6 text-brand-600" />
          </div>
          <h1 className="text-center text-xl font-bold text-slate-900">Set a new password</h1>
          <p className="mt-2 text-center text-sm text-slate-500">
            {user?.name || 'You'} — for your security, choose a new password before continuing to {branding?.name || 'the CRM'}.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="newPassword" className="label">New password</label>
              <input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                className="input"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="label">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                className="input"
                placeholder="Repeat new password"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? <Spinner className="h-4 w-4" /> : 'Save password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
