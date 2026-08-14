import { BarChart3 } from 'lucide-react';

/**
 * Lightweight empty chart area. Renders axes/grid so the layout is visible,
 * with a "no data yet" state. Fed with real series data in Phase 2.
 */
export default function ChartPlaceholder({ title, subtitle = 'No data yet' }) {
  const gridLines = [0, 1, 2, 3, 4];
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          <BarChart3 className="h-3.5 w-3.5" /> Empty
        </span>
      </div>
      <div className="relative flex-1">
        <svg viewBox="0 0 400 200" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
          {gridLines.map((i) => {
            const y = 20 + i * 40;
            return <line key={i} x1="0" y1={y} x2="400" y2={y} stroke="#e2e8f0" strokeWidth="1" />;
          })}
          <line x1="0" y1="180" x2="400" y2="180" stroke="#cbd5e1" strokeWidth="1.5" />
          <line x1="0" y1="20" x2="0" y2="180" stroke="#cbd5e1" strokeWidth="1.5" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <BarChart3 className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-400">{subtitle}</p>
          <p className="text-xs text-slate-400">Data will appear once this module is active</p>
        </div>
      </div>
    </div>
  );
}
