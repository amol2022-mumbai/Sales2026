import { useEffect, useRef, useState } from 'react';
import { Search, User, Building2, Users, Loader2 } from 'lucide-react';
import { searchApi } from '../../api/endpoints.js';

function ResultGroup({ title, items, icon: Icon, empty }) {
  return (
    <div className="px-1 py-1">
      <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      {items.length === 0 ? (
        <p className="px-3 py-1 text-sm text-slate-400">{empty || 'No matches'}</p>
      ) : (
        items.map((item) => (
          <div key={`${title}-${item.id}`} className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            <Icon className="h-4 w-4 text-slate-400" />
            <span className="truncate">{item.name || item.email}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchApi.global(query.trim());
        setResults(data.results);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const hasResults = results && Object.values(results).some((arr) => arr.length > 0);

  return (
    <div className="relative w-full max-w-md" ref={containerRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search users, companies, teams…"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-8 text-sm text-slate-900 placeholder-slate-400 transition focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {loading ? (
            <p className="px-3 py-4 text-center text-sm text-slate-400">Searching…</p>
          ) : !results ? (
            <p className="px-3 py-4 text-center text-sm text-slate-400">Type to search</p>
          ) : !hasResults ? (
            <p className="px-3 py-4 text-center text-sm text-slate-400">No results for &ldquo;{query}&rdquo;</p>
          ) : (
            <>
              <ResultGroup title="Users" items={results.users || []} icon={User} />
              <ResultGroup title="Companies" items={results.companies || []} icon={Building2} />
              <ResultGroup title="Teams" items={results.teams || []} icon={Users} />
              <ResultGroup title="Leads" items={results.leads || []} icon={User} />
              <ResultGroup title="Customers" items={results.customers || []} icon={User} />
              <ResultGroup title="Products" items={results.products || []} icon={User} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
