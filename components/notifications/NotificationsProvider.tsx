'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { notificationsFeedRepository, type NotificationsSnapshot } from '@/lib/storage';

interface NotificationsContextValue {
  snapshot: NotificationsSnapshot | null;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeAll: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/** How often the bell checks for new notifications while the app is open. */
const POLL_MS = 60_000;

/**
 * Loads the notification history once for the whole app (the bell needs the unread count on
 * every screen, not only on the Notificações screen) and again every minute, so the badge
 * catches up with whatever a background job just generated.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<NotificationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await notificationsFeedRepository.list());
    } catch {
      // The bell just shows no badge; nothing else in the app depends on this succeeding.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const markRead = useCallback(
    async (id: string) => {
      await notificationsFeedRepository.markRead(id);
      await refresh();
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    await notificationsFeedRepository.markAllRead();
    await refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await notificationsFeedRepository.remove(id);
      await refresh();
    },
    [refresh],
  );

  const removeAll = useCallback(async () => {
    await notificationsFeedRepository.removeAll();
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ snapshot, loading, refresh, markRead, markAllRead, remove, removeAll }),
    [snapshot, loading, refresh, markRead, markAllRead, remove, removeAll],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications precisa estar dentro de <NotificationsProvider>.');
  return ctx;
}
