import { BarChart3 } from 'lucide-react';
import { useBranding } from '../../context/BrandContext.jsx';

export default function Logo({ compact = false }) {
  const { branding } = useBranding();
  const name = branding?.name || 'SalesDesk';

  return (
    <div className="flex items-center gap-2.5">
      {branding?.logoUrl ? (
        <img src={branding.logoUrl} alt={name} className="h-9 w-9 rounded-lg object-contain" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
          <BarChart3 className="h-5 w-5" />
        </div>
      )}
      {!compact && (
        <div className="leading-tight">
          <span className="block max-w-[140px] truncate text-base font-bold tracking-tight text-slate-900">{name}</span>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">CRM Suite</span>
        </div>
      )}
    </div>
  );
}
