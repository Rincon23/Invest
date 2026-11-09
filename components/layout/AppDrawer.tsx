'use client';

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react';
import { ChevronDown, LayoutGrid, List, Server, Settings, ShieldCheck } from 'lucide-react';
import type { ModuleKey, Month } from '@/lib/budget';
import { moduleDefinition, moreItems, navEntry } from '@/lib/modules';
import type { NotificationCategory } from '@/lib/notifications';
import { getStoredMoreLayout, setStoredMoreLayout, type MoreLayout } from '@/lib/storage/preferences';
import { MoreMenu, type MoreMenuSection } from '@/components/layout/MoreMenu';
import { MODULE_VISUALS } from '@/components/modules/visuals';
import { useNotifications } from '@/components/notifications/NotificationsProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { MissionsCard } from '@/components/missions/MissionsCard';
import { useSettings } from '@/components/providers/SettingsProvider';
import { popSheetEntry, pushSheetEntry, registerSheet } from '@/components/ui/sheetHistory';
import { BACK_MS, COMMIT_VELOCITY, EASE, IN_MS, MIN_FLICK_DISTANCE } from './swipePhysics';
import { useVerticalDrag } from './useVerticalDrag';

/** Which app icons carry a count of unread notifications, and which category counts toward it. */
const MODULE_NOTIFICATION_CATEGORY: Partial<Record<ModuleKey, NotificationCategory>> = {
  reminders: 'reminder',
  recurring: 'recurring',
};

/** How much of its height the drawer has to travel (up to open, down to close) to go through. */
export const DRAWER_COMMIT_FRACTION = 0.25;

/** Whether a drag of `distance` px at `speed` px/ms opens (or closes) a drawer `height` px tall. */
export function drawerCommits(distance: number, height: number, speed: number): boolean {
  return (
    distance > height * DRAWER_COMMIT_FRACTION || (speed > COMMIT_VELOCITY && distance > MIN_FLICK_DISTANCE)
  );
}

/** If the page a tapped app opens takes this long to show, the drawer gets out of the way anyway. */
const NAVIGATION_FALLBACK_MS = 1500;

export interface AppDrawerHandle {
  /** Opens it with a slide (a tap on the up-arrow, Enter, an old link to /mais). */
  open: () => void;
  /** The finger dragging it up from the up-arrow: `hidden` px of it are still below the screen. */
  follow: (hidden: number) => void;
  /** The finger let go: it opens the rest of the way, or slides back down. */
  settle: (open: boolean) => void;
  /** How tall it is, to turn a drag into how much of it shows. */
  height: () => number;
}

/**
 * The app drawer, which used to be the "Mais" tab: the account, every module (with the unread
 * count of Lembretes on its icon), Privacidade, Configurações and, for the
 * server's owner, Administração. It covers the whole Início over a blurred backdrop, like a
 * phone's app drawer, and comes up from the up-arrow following the finger.
 *
 * Open, it is a dialog: it keeps the focus inside, the phone's back button closes it (its own
 * history entry, see `sheetHistory.ts`), and so do Esc, the "⌄" on top and a drag down while the
 * list is at its top. Tapping an app opens it, and the drawer goes with the Início.
 */
export function AppDrawer({
  ref,
  month,
  onOpened,
  onClosed,
}: {
  ref?: Ref<AppDrawerHandle>;
  /** The month the module screens open on: the one the Início is showing. */
  month: Month;
  /** It finished opening (the up-arrow stops hopping once the person has found it). */
  onOpened?: () => void;
  /** It finished closing: the focus goes back to the up-arrow. */
  onClosed?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  /** Settled open: a history entry of its own and the focus inside. */
  const [settled, setSettled] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  /** Where the panel has to be as soon as it mounts (and, for `open`, where it slides to). */
  const start = useRef<{ hidden: number; slideTo?: number } | null>(null);
  const entry = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  const height = useCallback(() => panel.current?.offsetHeight ?? window.innerHeight, []);

  const place = useCallback(
    (hidden: number, ms = 0) => {
      const el = panel.current;
      if (!el) return;
      const transition = ms > 0 ? `${ms}ms ${EASE}` : null;
      el.style.transition = transition ? `transform ${transition}` : 'none';
      el.style.transform = `translate3d(0, ${hidden}px, 0)`;
      if (backdrop.current) {
        backdrop.current.style.transition = transition ? `opacity ${transition}` : 'none';
        backdrop.current.style.opacity = String(Math.max(0, Math.min(1, 1 - hidden / height())));
      }
    },
    [height],
  );

  const later = useCallback((ms: number, run: () => void) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      run();
    }, ms);
  }, []);

  const slideOpen = useCallback(() => {
    place(0, IN_MS);
    later(IN_MS, () => {
      setSettled(true);
      onOpened?.();
    });
  }, [place, later, onOpened]);

  /** Slides away. `popEntry: false` when its history entry is already gone (the back button took it). */
  const close = useCallback(
    (popEntry = true) => {
      if (popEntry && entry.current) popSheetEntry(entry.current);
      entry.current = null;
      setSettled(false);
      place(height(), BACK_MS);
      later(BACK_MS, () => {
        setMounted(false);
        onClosed?.();
      });
    },
    [place, height, later, onClosed],
  );

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (panel.current) return slideOpen();
        start.current = { hidden: window.innerHeight, slideTo: 0 };
        setMounted(true);
      },
      follow: (hidden) => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        if (panel.current) return place(hidden);
        start.current = { hidden };
        setMounted(true);
      },
      settle: (open) => (open ? slideOpen() : close(false)),
      height,
    }),
    [slideOpen, place, close, height],
  );

  // First frame of a freshly mounted drawer: where the finger (or the slide) starts from.
  useLayoutEffect(() => {
    if (!mounted || !start.current) return;
    const { hidden, slideTo } = start.current;
    start.current = null;
    place(hidden);
    if (slideTo !== undefined) {
      // The start position has to be laid out before the slide can run from it.
      void panel.current?.offsetHeight;
      slideOpen();
    }
  }, [mounted, place, slideOpen]);

  // The latest `close`, so the Início re-rendering under an open drawer pushes no history entry of
  // its own: one on top of a sheet opened from here, and the back button would close the drawer.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // Open for good: the back button closes it.
  useEffect(() => {
    if (!settled) return;
    entry.current = pushSheetEntry();
    return registerSheet({
      get entry() {
        return entry.current ?? '';
      },
      onBack: () => closeRef.current(false),
    });
  }, [settled]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        ref={backdrop}
        aria-hidden
        className="absolute inset-0 bg-black/30 opacity-0 backdrop-blur-md"
        onClick={() => close()}
      />
      <DrawerPanel
        panelRef={panel}
        month={month}
        settled={settled}
        onClose={() => close()}
        onDrag={(distance) => place(distance)}
        onDragEnd={(distance, speed) => {
          if (drawerCommits(distance, height(), speed)) close();
          else place(0, BACK_MS);
        }}
        onNavigate={() => later(NAVIGATION_FALLBACK_MS, () => close())}
      />
    </div>
  );
}

function DrawerPanel({
  panelRef,
  month,
  settled,
  onClose,
  onDrag,
  onDragEnd,
  onNavigate,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  month: Month;
  settled: boolean;
  onClose: () => void;
  onDrag: (distance: number) => void;
  onDragEnd: (distance: number, speed: number) => void;
  onNavigate: () => void;
}) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { snapshot } = useNotifications();
  // Mounted only in the browser (it opens on a gesture), so the device's choice is read directly.
  const [layout, setLayout] = useState<MoreLayout>(getStoredMoreLayout);
  const list = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Pulled down while the list is at its top: the drawer follows the finger and closes.
  useVerticalDrag(panelRef, {
    direction: 'down',
    canStart: () => (list.current?.scrollTop ?? 0) <= 0,
    onMove: onDrag,
    onEnd: onDragEnd,
  });

  useEffect(() => {
    if (settled) closeButton.current?.focus({ preventScroll: true });
  }, [settled]);

  function toggleLayout() {
    const next: MoreLayout = layout === 'grid' ? 'list' : 'grid';
    setLayout(next);
    setStoredMoreLayout(next);
  }

  /** Esc closes; Tab goes round inside the drawer instead of reaching the Início under it. */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const unread = (category: NotificationCategory): number =>
    snapshot?.notifications.filter((n) => n.category === category && !n.readAt).length ?? 0;

  const sections: MoreMenuSection[] = [
    ...moreItems(settings).map((group) => ({
      title: group.label,
      // Missões is its card here (level, bar and the next missions), not an icon.
      content: group.keys.includes('missions') ? <MissionsCard onNavigate={onNavigate} /> : undefined,
      items: group.keys
        .filter((key) => key !== 'missions')
        .map((key) => {
          const category = MODULE_NOTIFICATION_CATEGORY[key];
          return {
            key,
            label: moduleDefinition(key).name,
            description: moduleDefinition(key).tagline,
            icon: MODULE_VISUALS[key].icon,
            tone: MODULE_VISUALS[key].tone,
            href: navEntry(key).href(month),
            badge: category ? unread(category) : 0,
          };
        }),
    })),
    {
      title: 'Ajustes',
      items: [
        {
          key: 'privacidade',
          label: 'Privacidade',
          description: 'Como o Capital + trata os seus dados',
          icon: ShieldCheck,
          tone: 'green',
          href: '/privacidade',
        },
        {
          key: 'configuracoes',
          label: 'Configurações',
          description: 'Conta, tema e backup',
          icon: Settings,
          tone: 'neutral',
          href: '/configuracoes',
        },
        // Only whoever runs the server (OWNER_EMAIL) sees it; for anyone else the page is a 404.
        ...(user.owner
          ? [
              {
                key: 'admin',
                label: 'Administração',
                description: 'Saúde do servidor, testes, contas e acessos',
                icon: Server,
                tone: 'amber' as const,
                href: '/admin',
                // Server warnings (a test that failed, the board heating up) land in the bell as "system".
                badge: unread('system'),
              },
            ]
          : []),
      ],
    },
  ];

  const ToggleIcon = layout === 'grid' ? List : LayoutGrid;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Todos os apps"
      onKeyDown={handleKeyDown}
      className="bg-background/85 absolute inset-0 flex flex-col backdrop-blur-xl"
      style={{ transform: 'translate3d(0, 100%, 0)', paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex shrink-0 flex-col items-center gap-1 px-4 pt-2">
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Fechar todos os apps"
          className="text-muted hover:text-foreground flex h-10 w-16 items-center justify-center rounded-full"
        >
          <ChevronDown aria-hidden className="h-6 w-6" />
        </button>
        <div className="flex w-full items-center justify-between gap-2 pb-2">
          <h2 className="text-foreground text-lg font-semibold">Todos os apps</h2>
          <button
            type="button"
            onClick={toggleLayout}
            aria-label={layout === 'grid' ? 'Ver em lista' : 'Ver em grade'}
            className="text-muted hover:text-foreground hover:bg-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <ToggleIcon aria-hidden className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        ref={list}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10"
        style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
      >
        <MoreMenu
          user={{ name: user.name, email: user.email }}
          sections={sections}
          layout={layout}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}
