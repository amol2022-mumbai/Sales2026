import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AcceptInvitePage from './pages/AcceptInvitePage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import CompanySettingsPage from './pages/CompanySettingsPage.jsx';
import UserManagementPage from './pages/UserManagementPage.jsx';
import RolesPermissionsPage from './pages/RolesPermissionsPage.jsx';
import TeamsPage from './pages/TeamsPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import LeadProfilePage from './pages/LeadProfilePage.jsx';
import CustomersPage from './pages/CustomersPage.jsx';
import CustomerProfilePage from './pages/CustomerProfilePage.jsx';
import FollowUpsPage from './pages/FollowUpsPage.jsx';
import PipelinePage from './pages/PipelinePage.jsx';
import TargetsPage from './pages/TargetsPage.jsx';
import CollectionsPage from './pages/CollectionsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import MISPage from './pages/MISPage.jsx';
import BillingPage from './pages/BillingPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import ComingSoonPage from './pages/ComingSoonPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import { ALL_NAV_ITEMS } from './lib/navigation.jsx';

const comingSoonPaths = ALL_NAV_ITEMS.filter((i) => !i.functional).map((i) => i.path);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<CompanySettingsPage />} />
          <Route path="/users" element={<UserManagementPage />} />
          <Route path="/roles" element={<RolesPermissionsPage />} />
          <Route path="/sales-team" element={<TeamsPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadProfilePage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerProfilePage />} />
          <Route path="/follow-ups" element={<FollowUpsPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/targets" element={<TargetsPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/mis" element={<MISPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/admin/*" element={<AdminPage />} />
          {comingSoonPaths.map((path) => (
            <Route key={path} path={path} element={<ComingSoonPage />} />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
