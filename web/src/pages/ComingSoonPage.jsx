import { useLocation, Link } from 'react-router-dom';
import { Hammer } from 'lucide-react';
import { ALL_NAV_ITEMS } from '../lib/navigation.jsx';

export default function ComingSoonPage() {
  const { pathname } = useLocation();
  const item = ALL_NAV_ITEMS.find((i) => i.path === pathname);
  const label = item?.label || 'Module';
  const Icon = item?.icon || Hammer;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <Icon className="h-8 w-8" />
      </div>
      <h1 className="mt-6 text-2xl font-bold text-slate-900">{label}</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        This module is coming soon. We&apos;re actively building it out.
      </p>
      <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
        <Hammer className="h-3.5 w-3.5" /> Coming Soon
      </span>
      <Link to="/" className="btn-secondary mt-8">Back to Dashboard</Link>
    </div>
  );
}
