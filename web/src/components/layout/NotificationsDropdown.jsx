import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { notificationsApi } from '../../api/endpoints.js';

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef(null);

  async function load() {
    try {
      const data = await notificationsApi.list({ pageSize: 20 });
      setItems(data.items || []);
      setUnread(data.unreadCount || 0);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function markRead(id) {
    await notificationsApi.markRead(id);
    load();
  }
  async function markAll() {
    await notificationsApi.markAllRead();
    load();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No notifications yet</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.isRead && markRead(n.id)}
                  className={`flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${n.isRead ? 'opacity-60' : ''}`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-slate-200' : 'bg-brand-500'}`} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-slate-800">{n.title}</span>
                    {n.body && <span className="block text-xs text-slate-500">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
