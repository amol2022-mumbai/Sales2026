import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Clock, Sparkles, CreditCard } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { daysRemaining, remainingDaysLabel } from '../../lib/license.js';

/**
 * App-wide license/trial notice shown to company users. Only appears when the
 * tenant has a license whose status warrants attention (trial, expiring, past
 * due, expired or cancelled). It is never shown to super admins or during the
 * first-run onboarding flow.
 */
export default function LicenseBanner() {
  const { user, tenant } = useAuth();
  const { pathname } = useLocation();

  if (user?.isSuperAdmin) return null;
  if (pathname === '/onboarding') return null;

  const license = tenant?.license;
  if (!license) return null;

  const status = license.status;
  const days = daysRemaining(license.expiresAt);

  let tone;
  let icon;
  let title;
  let detail;
  let actionLabel;
  let actionTo;

  if (status === 'trial') {
    tone = 'border-indigo-200 bg-indigo-50 text-indigo-800';
    icon = <Sparkles className="h-4 w-4 shrink-0 text-indigo-600" />;
    title = `You're on the ${license.planName || 'trial'} trial`;
    detail = remainingDaysLabel(license.expiresAt);
    actionLabel = 'Upgrade now';
    actionTo = '/billing';
  } else if (status === 'expiring') {
    tone = 'border-sky-200 bg-sky-50 text-sky-800';
    icon = <Clock className="h-4 w-4 shrink-0 text-sky-600" />;
    title = 'Your license is expiring soon';
    detail = days != null && days >= 0 ? remainingDaysLabel(license.expiresAt) : null;
    actionLabel = 'Renew plan';
    actionTo = '/billing';
  } else if (status === 'past_due') {
    tone = 'border-amber-200 bg-amber-50 text-amber-800';
    icon = <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />;
    title = 'Your subscription payment is past due';
    detail = 'Update your payment method or renew to avoid interruption.';
    actionLabel = 'Manage billing';
    actionTo = '/billing';
  } else if (status === 'expired') {
    tone = 'border-rose-200 bg-rose-50 text-rose-700';
    icon = <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />;
    title = 'Your license has expired';
    detail = 'Renew your plan to restore full access.';
    actionLabel = 'Renew now';
    actionTo = '/billing';
  } else if (status === 'cancelled') {
    tone = 'border-slate-200 bg-slate-100 text-slate-700';
    icon = <CreditCard className="h-4 w-4 shrink-0 text-slate-500" />;
    title = 'Your subscription has been cancelled';
    detail = 'Reactivate your plan to continue using your workspace.';
    actionLabel = 'Reactivate';
    actionTo = '/billing';
  } else {
    return null;
  }

  return (
    <div className={`border-b ${tone}`}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm lg:px-6">
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {title}
        </span>
        {detail && <span className="text-xs opacity-80">{detail}</span>}
        <Link to={actionTo} className="ml-auto rounded-md bg-white/70 px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5 hover:bg-white">
          {actionLabel}
        </Link>
      </div>
    </div>
  );
}
