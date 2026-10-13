import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './client';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Minimal data-fetching hook with loading/error states and a manual `reload`.
 * Deliberately dependency-light (no react-query) to keep the MVP surface small.
 */
export function useApiQuery<T>(
  path: string | null,
  options: { enabled?: boolean; deps?: unknown[] } = {},
): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path) && enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!path || !enabled) {
      setLoading(false);
      return;
    }
    const current = ++requestId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    api
      .get<T>(path, { signal: controller.signal })
      .then((result) => {
        if (current !== requestId.current) return;
        setData(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || current !== requestId.current) return;
        setError(errorMessage(cause));
        setData(null);
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, nonce, ...(options.deps ?? [])]);

  return { data, loading, error, reload };
}

/** Ticking clock (1s) used by countdown badges. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export interface ToastMessage {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}

let toastId = 0;

/** Very small toast queue for post-action feedback. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const push = useCallback((tone: ToastMessage['tone'], text: string) => {
    const id = ++toastId;
    setToasts((current) => [...current, { id, tone, text }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 6000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, push, dismiss };
}
