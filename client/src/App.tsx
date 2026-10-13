import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './state/AuthContext';
import { LoadingState } from './components/ui';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { BrowsePage } from './pages/BrowsePage';
import { ListingDetailPage } from './pages/ListingDetailPage';
import { ProviderPage } from './pages/ProviderPage';
import { RecipientPage } from './pages/RecipientPage';
import { ImpactPage } from './pages/ImpactPage';
import { AdminPage } from './pages/AdminPage';
import { NotFoundPage } from './pages/NotFoundPage';
import type { Role } from '@shared';

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role as Role)) {
    return (
      <div className="fr-card p-6" role="alert">
        <h1 className="text-lg font-semibold text-stone-900">Not available for your role</h1>
        <p className="mt-1 text-sm text-stone-600">
          This page is for {roles.map((role) => role.toLowerCase()).join(' / ')} accounts. You are
          signed in as {user.role.toLowerCase()}.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/listings/:id" element={<ListingDetailPage />} />
        <Route
          path="/provider"
          element={
            <RequireRole roles={['PROVIDER']}>
              <ProviderPage />
            </RequireRole>
          }
        />
        <Route
          path="/recipient"
          element={
            <RequireRole roles={['RECIPIENT']}>
              <RecipientPage />
            </RequireRole>
          }
        />
        <Route
          path="/impact"
          element={
            <RequireRole roles={['PROVIDER', 'RECIPIENT', 'ADMIN']}>
              <ImpactPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireRole roles={['ADMIN']}>
              <AdminPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
