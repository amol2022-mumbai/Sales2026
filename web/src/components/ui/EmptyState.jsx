import { Inbox } from 'lucide-react';

/**
 * Reusable empty state used across list/detail screens. Provides a consistent
 * icon, title, description and optional call-to-action instead of ad-hoc text.
 */
export default function EmptyState({ icon: Icon = Inbox, title, description, action = null, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center ${className}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
