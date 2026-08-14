import { NavLink } from 'react-router-dom';
import { X, Boxes } from 'lucide-react';
import { PLATFORM_NAV_SECTIONS } from '../../lib/platformNavigation.jsx';
import { useBranding } from '../../context/BrandContext.jsx';

function PlatformSidebarContent({ onNavigate }) {
  const { branding } = useBranding();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
          <Boxes className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <span className="block max-w-[140px] truncate text-base font-bold tracking-tight text-slate-900">
            {branding?.name || 'SalesDesk'}
          </span>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">Platform Console</span>
        </div>
      </div>

      <div className="px-5 pb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white">
          Super Admin
        </span>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {PLATFORM_NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <NavLink
                    to={item.path}
                    end={item.end || item.path === '/admin'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`} />
                        <span className="flex-1 truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <p className="text-xs text-slate-400">Platform-wide administration</p>
      </div>
    </div>
  );
}

export default function PlatformSidebar({ mobileOpen, onClose }) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="sticky top-0 h-screen">
          <PlatformSidebarContent />
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85%] bg-white shadow-xl">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-4 rounded-md p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <PlatformSidebarContent onNavigate={onClose} />
          </aside>
        </div>
      )}
    </>
  );
}
