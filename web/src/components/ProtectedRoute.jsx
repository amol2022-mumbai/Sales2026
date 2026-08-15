import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Spinner from './ui/Spinner.jsx';

export default function ProtectedRoute() {
  const { user, tenant, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Forced password replacement: an account issued temporary credentials is
  // locked into the change-password screen until it sets a new password.
  const needsPasswordChange = !user.isSuperAdmin && user.mustChangePassword;
  const onPasswordChange = location.pathname === '/change-password';
  if (needsPasswordChange && !onPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }
  if (!needsPasswordChange && onPasswordChange) {
    return <Navigate to="/" replace />;
  }

  // Company Admin first-login gate: route an un-onboarded business owner to the
  // onboarding flow, and keep already-onboarded users off it.
  const needsOnboarding = !user.isSuperAdmin && user.roleKey === 'business_owner' && tenant && !tenant.onboardedAt;
  const onOnboarding = location.pathname === '/onboarding';
  if (needsOnboarding && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  if (!needsOnboarding && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
