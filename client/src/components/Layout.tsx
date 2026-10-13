import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { NotificationBellContainer } from './NotificationBell';
import { humanizeEnum } from '../lib/format';

function navClass({ isActive }: { isActive: boolean }): string {
  return `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-emerald-100 text-emerald-900' : 'text-stone-700 hover:bg-stone-100'
  }`;
}

export function Layout() {
  const { user, capabilities, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 rounded-lg px-1 py-1">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700 text-sm font-bold text-white"
              aria-hidden="true"
            >
              FR
            </span>
            <span className="text-lg font-bold tracking-tight text-stone-900">FreshRelay</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink to="/browse" className={navClass}>
              Browse
            </NavLink>
            {user?.role === 'PROVIDER' ? (
              <NavLink to="/provider" className={navClass}>
                My listings
              </NavLink>
            ) : null}
            {user?.role === 'RECIPIENT' ? (
              <NavLink to="/recipient" className={navClass}>
                My reservations
              </NavLink>
            ) : null}
            {user ? (
              <NavLink to="/impact" className={navClass}>
                Impact
              </NavLink>
            ) : null}
            {capabilities?.canModerateOrganizations ? (
              <NavLink to="/admin" className={navClass}>
                Admin
              </NavLink>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user ? <NotificationBellContainer /> : null}
            {user ? (
              <div className="hidden items-center gap-2 sm:flex">
                <div className="text-right">
                  <p className="text-sm font-semibold text-stone-800">{user.displayName}</p>
                  <p className="text-xs text-stone-500">
                    {user.organizationName ?? 'Platform admin'} · {humanizeEnum(user.role)}
                  </p>
                </div>
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => void handleLogout()}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <Link to="/login" className="fr-btn-secondary">
                  Sign in
                </Link>
                <Link to="/register" className="fr-btn-primary">
                  Create account
                </Link>
              </div>
            )}
            <button
              type="button"
              className="rounded-lg p-2 text-stone-700 hover:bg-stone-100 md:hidden"
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav
            className="border-t border-stone-200 bg-white px-4 py-2 md:hidden"
            aria-label="Mobile"
          >
            <div className="flex flex-col gap-1">
              <NavLink to="/browse" className={navClass} onClick={() => setMenuOpen(false)}>
                Browse
              </NavLink>
              {user?.role === 'PROVIDER' ? (
                <NavLink to="/provider" className={navClass} onClick={() => setMenuOpen(false)}>
                  My listings
                </NavLink>
              ) : null}
              {user?.role === 'RECIPIENT' ? (
                <NavLink to="/recipient" className={navClass} onClick={() => setMenuOpen(false)}>
                  My reservations
                </NavLink>
              ) : null}
              {user ? (
                <NavLink to="/impact" className={navClass} onClick={() => setMenuOpen(false)}>
                  Impact
                </NavLink>
              ) : null}
              {capabilities?.canModerateOrganizations ? (
                <NavLink to="/admin" className={navClass} onClick={() => setMenuOpen(false)}>
                  Admin
                </NavLink>
              ) : null}
              {user ? (
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-left text-sm font-medium text-stone-700 hover:bg-stone-100"
                  onClick={() => void handleLogout()}
                >
                  Sign out ({user.displayName})
                </button>
              ) : (
                <>
                  <NavLink to="/login" className={navClass} onClick={() => setMenuOpen(false)}>
                    Sign in
                  </NavLink>
                  <NavLink to="/register" className={navClass} onClick={() => setMenuOpen(false)}>
                    Create account
                  </NavLink>
                </>
              )}
            </div>
          </nav>
        ) : null}
      </header>

      {capabilities?.blockedReason ? (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          role="status"
        >
          <div className="mx-auto max-w-6xl">{capabilities.blockedReason}</div>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 bg-white px-4 py-6 text-sm text-stone-600">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            FreshRelay — surplus food rescue for Hyderabad and beyond. Local demo build; not for
            production use.
          </p>
          <p>
            Source:{' '}
            <a
              className="underline"
              href="https://www.unep.org/resources/publication/food-waste-index-report-2024"
              target="_blank"
              rel="noreferrer"
            >
              UNEP Food Waste Index 2024
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
