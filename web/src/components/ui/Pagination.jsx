import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) return null;
  const { page, totalPages, total } = meta;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
      <p className="text-xs text-slate-500">
        Showing page <span className="font-medium text-slate-700">{page}</span> of{' '}
        <span className="font-medium text-slate-700">{totalPages}</span> · {total} total
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary px-2.5 py-1.5"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn-secondary px-2.5 py-1.5"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
