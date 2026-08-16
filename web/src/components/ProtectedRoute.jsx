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
  // locked into the change-password screen until it sets a new password. This
  // gate takes full priority and short-circuits the onboarding gate below, so a
  // not-yet-onboarded admin is not bounced back and forth between the two.
  const needsPasswordChange = !user.isSuperAdmin && user.mustChangePassword;
  const onPasswordChange = location.pathname === '/change-password';
  if (needsPasswordChange) {
    if (!onPasswordChange) {
      return <Navigate to="/change-password" replace />;
    }
    return <Outlet />;
  }
  if (onPasswordChange) {
    return <Navigate to="/" replace />;
  }

  // Company Admin first-login gate: route an un-onboarded business owner to the
  // onboarding flow, and keep already-onboarded users off it.
  //
  // The Sales Team and Users screens are reachable directly from onboarding
  // Step 4 ("Create sales team" / "Invite users"), so they are exempt from the
  // redirect. This lets a business owner set up their team during onboarding
  // without being bounced back to the Welcome step.
  const ONBOARDING_EXEMPT_PATHS = ['/sales-team', '/users'];
  const needsOnboarding = !user.isSuperAdmin && user.roleKey === 'business_owner' && tenant && !tenant.onboardedAt;
  const onOnboarding = location.pathname === '/onboarding';
  const onOnboardingExemptPath = ONBOARDING_EXEMPT_PATHS.includes(location.pathname);
  if (needsOnboarding && !onOnboarding && !onOnboardingExemptPath) {
    return <Navigate to="/onboarding" replace />;
  }
  if (!needsOnboarding && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
