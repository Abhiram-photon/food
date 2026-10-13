import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import type { NotificationListResponse, NotificationView } from '@shared';
import { formatDateTime } from '../lib/format';

/** Poll interval for the unread badge. In-app notifications only (email is deferred). */
const POLL_MS = 60_000;

export function NotificationBell({
  notifications,
  unreadCount,
  onMarkAllRead,
  loading,
  error,
}: {
  notifications: NotificationView[];
  unreadCount: number;
  onMarkAllRead: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="relative rounded-lg p-2 text-stone-700 hover:bg-stone-100"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8.5 15a1.5 1.5 0 003 0h-3z" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white p-3 shadow-lg"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-800">Notifications</h2>
            <button
              type="button"
              className="text-xs font-semibold text-emerald-700 underline disabled:text-stone-400"
              onClick={onMarkAllRead}
              disabled={unreadCount === 0}
            >
              Mark all read
            </button>
          </div>

          {loading ? (
            <p className="p-3 text-sm text-stone-600">Loading…</p>
          ) : error ? (
            <p className="p-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : notifications.length === 0 ? (
            <p className="p-3 text-sm text-stone-600">
              No notifications yet. Reservations, cancellations and verifications show up here.
            </p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {notifications.slice(0, 10).map((notification) => (
                <li key={notification.id}>
                  <Link
                    to={notification.link ?? '/'}
                    className={`block rounded-lg p-2 text-sm hover:bg-stone-100 ${
                      notification.readAt ? 'text-stone-600' : 'bg-emerald-50 text-stone-900'
                    }`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="block font-semibold">{notification.title}</span>
                    <span className="block text-xs text-stone-600">{notification.body}</span>
                    <span className="mt-0.5 block text-[11px] text-stone-500">
                      {formatDateTime(notification.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Data container for the bell: polls the unread count and exposes the newest
 * notifications to the dropdown.
 */
export function NotificationBellContainer() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await api.get<NotificationListResponse>('/notifications?limit=20');
        if (cancelled) return;
        setNotifications(response.notifications);
        setUnreadCount(response.unreadCount);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load notifications');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  async function markAllRead() {
    try {
      await api.post('/notifications/read', { all: true });
      setNotifications((current) => current.map((n) => ({ ...n, readAt: new Date().toISOString() })));
      setUnreadCount(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update notifications');
    }
  }

  return (
    <NotificationBell
      notifications={notifications}
      unreadCount={unreadCount}
      onMarkAllRead={() => void markAllRead()}
      loading={loading}
      error={error}
    />
  );
}
