'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useNotifications } from './NotificationsProvider';

/**
 * The sino: opens the Central de notificações, with a dot while there is something unread.
 * Shown top-right on the Início.
 */
export function NotificationBell() {
  const { snapshot } = useNotifications();
  const unread = snapshot?.unread ?? 0;

  return (
    <Link
      href="/notificacoes"
      aria-label={unread > 0 ? `Notificações, ${unread} não lidas` : 'Notificações'}
      className="text-muted hover:text-foreground hover:bg-card relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
    >
      <Bell aria-hidden className="h-5 w-5" />
      {unread > 0 && (
        <span
          aria-hidden
          className="bg-danger absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background"
        />
      )}
    </Link>
  );
}
