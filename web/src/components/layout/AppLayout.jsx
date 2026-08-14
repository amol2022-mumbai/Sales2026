import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import PlatformSidebar from './PlatformSidebar.jsx';
import Topbar from './Topbar.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const SidebarComponent = user?.isSuperAdmin ? PlatformSidebar : Sidebar;

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      <SidebarComponent mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-x-hidden p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
