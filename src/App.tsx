import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/Layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { GoogleCallbackPage } from './pages/GoogleCallbackPage';
import { DashboardPage } from './pages/DashboardPage';
import { ResourceDetailPage } from './pages/ResourceDetailPage';
import { ClaimPage } from './pages/ClaimPage';
import { SettingsPage } from './pages/SettingsPage';
import { DeployPage } from './pages/DeployPage';
import { BillingPage } from './pages/BillingPage';

// Pages that need the app shell (top nav + sidebar)
function ShellRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/resources/:id" element={<ResourceDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/deploy" element={<DeployPage />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <Routes>
      {/* Public routes — no shell */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
      <Route path="/claim" element={<ClaimPage />} />

      {/* Protected routes — with shell */}
      <Route path="/*" element={<ShellRoutes />} />

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
