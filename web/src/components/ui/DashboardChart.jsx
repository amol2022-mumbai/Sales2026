const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6'];

function formatTick(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return `${n}`;
  return n.toFixed(1);
}

/**
 * Lightweight grouped bar chart (no external charting dependency). Renders each
 * series as a group of bars across the provided labels.
 */
export default function DashboardChart({ title, labels = [], series = [] }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values || []).map((v) => Number(v) || 0));
  const groupCount = Math.max(1, labels.length);
  const seriesCount = Math.max(1, series.length);

  const hasData = series.some((s) => (s.values || []).some((v) => Number(v) > 0));

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <div className="flex items-center gap-3">
          {series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">No data yet</div>
      ) : (
        <div className="flex flex-1 items-end gap-2">
          {labels.map((label, gi) => (
            <div key={label} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-40 w-full items-end justify-center gap-1">
                {series.map((s, si) => {
                  const v = Number(s.values?.[gi]) || 0;
                  const h = (v / max) * 100;
                  return (
                    <div
                      key={s.name}
                      className="w-full max-w-6 rounded-t-sm transition-all"
                      style={{ height: `${h}%`, minHeight: v > 0 ? 2 : 0, backgroundColor: PALETTE[si % PALETTE.length] }}
                      title={`${label} · ${s.name}: ${v}`}
                    />
                  );
                })}
              </div>
              <span className="text-[10px] text-slate-400">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
