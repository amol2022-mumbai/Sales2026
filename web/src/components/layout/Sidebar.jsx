import { NavLink } from 'react-router-dom';
import { X, Building2 } from 'lucide-react';
import Logo from '../ui/Logo.jsx';
import { NAV_SECTIONS, isModuleEnabledForTenant } from '../../lib/navigation.jsx';
import { useAuth, can } from '../../context/AuthContext.jsx';

function SidebarContent({ onNavigate }) {
  const { user, tenant } = useAuth();

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        (!item.permission || can(user, item.permission)) &&
        isModuleEnabledForTenant(tenant, item.key)
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                        <span className="flex-1 truncate">{item.label}</span>
                        {!item.functional && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Soon
                          </span>
                        )}
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
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate font-medium text-slate-600">{tenant?.name || 'Company'}</span>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ mobileOpen, onClose }) {
  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile drawer */}
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
            <SidebarContent onNavigate={onClose} />
          </aside>
        </div>
      )}
    </>
  );
}
