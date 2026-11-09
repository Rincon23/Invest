'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Clock,
  Repeat,
  CreditCard,
  Landmark,
  Lightbulb,
  Mail,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useNotifications } from '@/components/notifications/NotificationsProvider';
import { SwipeToDelete } from '@/components/notifications/SwipeToDelete';
import { NotificationPreferencesSection } from '@/components/settings/NotificationPreferencesSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import { IconTile, type IconTone } from '@/components/ui/IconTile';
import {
  NOTIFICATION_CATEGORY_LABELS,
  type AppNotification,
  type NotificationCategory,
} from '@/lib/notifications';

const CATEGORY_VISUAL: Record<NotificationCategory, { icon: LucideIcon; tone: IconTone }> = {
  reminder: { icon: Clock, tone: 'amber' },
  card: { icon: CreditCard, tone: 'orange' },
  recurring: { icon: Repeat, tone: 'blue' },
  gmail: { icon: Mail, tone: 'red' },
  banks: { icon: Landmark, tone: 'blue' },
  feature: { icon: Sparkles, tone: 'purple' },
  motivation: { icon: Lightbulb, tone: 'green' },
  system: { icon: Bell, tone: 'neutral' },
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${day} às ${time}`;
}

/**
 * Central de notificações: everything the app has ever told this account, most recent first.
 * Opening it is seeing them — they are marked as read on the way in (the ones that were new keep
 * their dot until the person leaves), so nobody has to tap anything to clear the bell.
 */
export function NotificationsScreen() {
  const { snapshot, loading, markAllRead, remove, removeAll } = useNotifications();
  const [configuring, setConfiguring] = useState(false);
  const [clearing, setClearing] = useState(false);
  const router = useRouter();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const homeHref = useHomeHref();

  const items = snapshot?.notifications ?? [];

  // What was new when the screen opened (or arrived while it is open) stays marked as new here.
  const [seenNew, setSeenNew] = useState<Set<string>>(() => new Set());
  const marking = useRef(false);
  useEffect(() => {
    if (!snapshot || snapshot.unread === 0 || marking.current) return;
    const fresh = snapshot.notifications.filter((item) => !item.readAt).map((item) => item.id);
    setSeenNew((current) => new Set([...current, ...fresh]));
    marking.current = true;
    void markAllRead()
      .catch(() => {})
      .finally(() => {
        marking.current = false;
      });
  }, [snapshot, markAllRead]);

  function openNotification(item: AppNotification) {
    if (item.href) router.push(item.href);
  }

  async function clearAll() {
    const confirmed = await confirm({
      title: 'Limpar notificações',
      message: `${items.length === 1 ? 'A notificação sai' : `As ${items.length} notificações saem`} da lista. Isso não pode ser desfeito.`,
      confirmLabel: 'Limpar',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) return;
    setClearing(true);
    try {
      await removeAll();
      showToast('Notificações limpas.');
    } catch {
      showToast('Não foi possível limpar. Tente de novo.', 'error');
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      <PageHeader
        title="Notificações"
        backHref={homeHref}
        subtitle={seenNew.size > 0 ? `${seenNew.size} ${seenNew.size === 1 ? 'nova' : 'novas'}` : undefined}
        action={
          <>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => void clearAll()}
                disabled={clearing}
                aria-label="Limpar todas as notificações"
                className="text-muted hover:text-danger hover:bg-card flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfiguring(true)}
              aria-label="Configurações de notificações"
              title="Configurações"
              className="text-muted hover:text-foreground hover:bg-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
            >
              <SettingsIcon aria-hidden className="h-5 w-5" />
            </button>
          </>
        }
      />

      {loading && !snapshot ? (
        <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="border-border bg-card mx-4 flex flex-col items-center gap-2 rounded-2xl border p-6 text-center shadow-sm">
          <IconTile icon={Bell} tone="neutral" size="lg" />
          <p className="text-foreground font-semibold">Nada por aqui ainda</p>
          <p className="text-muted text-sm">Tudo que o Capital + te avisar aparece nesta lista.</p>
        </div>
      ) : (
        <>
          <p className="text-muted px-4 text-xs">Arraste uma notificação para o lado para excluí-la.</p>
          <ul className="flex flex-col gap-2 px-4" data-no-swipe-nav>
            {items.map((item) => {
              const visual = CATEGORY_VISUAL[item.category];
              const unreadItem = !item.readAt || seenNew.has(item.id);
              return (
                <li key={item.id}>
                  <SwipeToDelete onDelete={() => void remove(item.id)}>
                    <button
                      type="button"
                      onClick={() => openNotification(item)}
                      className={`border-border bg-card hover:border-primary/40 flex w-full items-start gap-3 border p-3 text-left shadow-sm ${
                        unreadItem ? '' : 'opacity-70'
                      }`}
                    >
                      <IconTile icon={visual.icon} tone={visual.tone} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span
                            className={`text-foreground block truncate ${unreadItem ? 'font-semibold' : 'font-medium'}`}
                          >
                            {item.title}
                          </span>
                          {unreadItem && (
                            <span aria-hidden className="bg-primary h-2 w-2 shrink-0 rounded-full" />
                          )}
                        </span>
                        <span className="text-muted block text-sm">{item.body}</span>
                        <span className="text-muted/80 block text-xs">
                          {NOTIFICATION_CATEGORY_LABELS[item.category]} · {formatWhen(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </SwipeToDelete>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {configuring && (
        <BottomSheet open title="Notificações" onClose={() => setConfiguring(false)}>
          <div className="flex flex-col gap-6">
            <NotificationsSection />
            <NotificationPreferencesSection />
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
