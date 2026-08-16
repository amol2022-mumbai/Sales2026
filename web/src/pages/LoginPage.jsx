import { useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Navigate } from 'react-router-dom';
import { ShieldCheck, TrendingUp, Users, Target } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandContext.jsx';
import Logo from '../components/ui/Logo.jsx';
import Spinner from '../components/ui/Spinner.jsx';

const FEATURES = [
  { icon: Users, text: 'Leads, customers & pipeline in one place' },
  { icon: TrendingUp, text: 'Sales, targets and performance tracking' },
  { icon: Target, text: 'Role-based access for your whole team' },
  { icon: ShieldCheck, text: 'Secure, multi-company isolated data' },
];

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // `relogin=1` (used by the Super Admin "Generate Temporary Credentials" login
  // URL) forces the sign-in form to render even when a session already exists,
  // so a Company Admin can sign in fresh without being bounced to the current
  // user's dashboard. An optional `email` query param prefills the username so
  // the Company Admin only enters the temporary password.
  const forceLogin = searchParams.get('relogin') != null;
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [password, setPassword] = useState('');

  if (!forceLogin && !loading && user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-brand-900 p-12 text-white lg:flex">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #818cf8 0, transparent 40%), radial-gradient(circle at 80% 80%, #6366f1 0, transparent 45%)' }} />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
              <TrendingUp className="h-6 w-6" />
            </div>
            <span className="text-lg font-bold tracking-tight">{branding?.name || 'SalesDesk'} CRM</span>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight">Grow your sales with a single source of truth.</h1>
          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-center gap-3 text-sm text-brand-100">
                <f.icon className="h-5 w-5 text-brand-300" />
                {f.text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to your account to continue.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? <Spinner className="h-4 w-4" /> : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            Default admin: <span className="font-medium text-slate-500">admin@example.com</span> (see .env.example)
          </p>
        </div>
      </div>
    </div>
  );
}
