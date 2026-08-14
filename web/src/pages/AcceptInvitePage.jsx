import { useState } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandContext.jsx';
import Logo from '../components/ui/Logo.jsx';
import Spinner from '../components/ui/Spinner.jsx';

export default function AcceptInvitePage() {
  const { user, loading, acceptInvite } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await acceptInvite(token, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to accept invitation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-brand-900 p-12 text-white lg:flex">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #818cf8 0, transparent 40%), radial-gradient(circle at 80% 80%, #6366f1 0, transparent 45%)' }} />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
            <TrendingUp className="h-6 w-6" />
          </div>
          <span className="text-lg font-bold tracking-tight">{branding?.name || 'SalesDesk'} CRM</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight">Welcome aboard.</h1>
          <p className="mt-4 text-sm text-brand-100">Set a password to activate your company administrator account and start using the platform.</p>
        </div>
        <p className="relative text-xs text-brand-200">Account activation</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Set your password</h2>
          <p className="mt-1 text-sm text-slate-500">Choose a password to activate your account.</p>

          {!token && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              This link is missing its invitation token.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="password" className="label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="label">Confirm password</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input"
                placeholder="Repeat password"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}

            <button type="submit" disabled={submitting || !token} className="btn-primary w-full">
              {submitting ? <Spinner className="h-4 w-4" /> : 'Activate account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
