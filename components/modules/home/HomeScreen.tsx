'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  Check,
  ChevronUp,
  CircleHelp,
  LayoutGrid,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { BudgetSettings, HomeWidgetKey } from '@/lib/budget';
import {
  HOME_HELP_ANCHOR,
  MAX_HOME_PAGES,
  addHomePage,
  addWidget,
  deleteHomePage,
  hiddenHomeCards,
  homeCards,
  homeEditTourSteps,
  isModuleOn,
  moveWidget,
  pageOfWidget,
  removeWidget,
  resolveHomePages,
  widgetName,
  withoutEmptyPages,
  type HomePages,
} from '@/lib/modules';
import { fetchHomeTemplate } from '@/lib/storage/homeTemplate';
import { getSessionHomePage, setSessionHomePage } from '@/lib/storage/preferences';
import { AppDrawer, drawerCommits, type AppDrawerHandle } from '@/components/layout/AppDrawer';
import { IN_MS } from '@/components/layout/swipePhysics';
import { useVerticalDrag } from '@/components/layout/useVerticalDrag';
import { subscribeHomeReveal } from '@/components/modules/tour/homeReveal';
import { useTour } from '@/components/modules/tour/TourProvider';
import { GreetingHeader } from '@/components/month/GreetingHeader';
import { MissionsBar } from '@/components/missions/MissionsBar';
import { MonthActions } from '@/components/month/MonthActions';
import { useMonthContext } from '@/components/month/MonthContext';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useSettings } from '@/components/providers/SettingsProvider';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { IconTile } from '@/components/ui/IconTile';
import { popSheetEntry, pushSheetEntry, registerSheet } from '@/components/ui/sheetHistory';
import { useToast } from '@/components/ui/Toast';
import { useOneTimeHint } from '@/components/ui/useOneTimeHint';
import { widgetVisual } from '../visuals';
import { EditableWidget } from './EditableWidget';
import { HomeDesk, type HomeDeskHandle } from './HomeDesk';
import { Card, HomeCards, HomeCardsData, RESIZABLE_HOME_CARDS, effectiveSize } from './HomeCards';
import { HOME_FOOTER_HEIGHT } from './homeLayout';
import { TRAY_BAR_HEIGHT, TRAY_ID, WidgetTray, widgetOfTrayDrag } from './WidgetTray';

/** Saved once the app drawer was opened: from then on the up-arrow stops hopping. */
const APPS_HINT = 'hint:apps';
/** The one-time "deslize" hint of an Início with more than one tela. */
const AREAS_HINT = 'hint:swipe-areas';

/** How long a widget has to be held before it comes loose, the way a phone picks up a widget. */
const HOLD_MS = 240;
/** How much the finger may wander during that hold before it counts as a scroll, not a hold. */
const HOLD_TOLERANCE = 8;
/** A widget held this close (px) to the left or right edge… */
const EDGE_ZONE = 32;
/** …for this long goes to the tela on that side (past the last one, a new tela). */
const EDGE_HOLD_MS = 600;

/**
 * Keeps the cards measured while they move around. With cards of two widths (half and full), a
 * stale measurement is what makes one land in the wrong slot and snap into place afterwards.
 */
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

type Sizes = Partial<Record<HomeWidgetKey, 'half' | 'full'>>;

/** What edit mode works on, saved as a whole on every change. */
interface HomeLayout {
  pages: HomePages;
  hidden: HomeWidgetKey[];
  sizes: Sizes;
}

interface ActiveDrag {
  widget: HomeWidgetKey;
  /** Picked up from the widget tray (not yet on any tela until it is dropped). */
  fromTray: boolean;
}

const pageId = (index: number) => `page:${index}`;
const pageOfId = (id: UniqueIdentifier): number | null =>
  typeof id === 'string' && id.startsWith('page:') ? Number(id.slice(5)) : null;
const widgetOfId = (id: UniqueIdentifier): HomeWidgetKey => widgetOfTrayDrag(id) ?? (id as HomeWidgetKey);

/** Which page is shown once the empty ones are gone (they go when edit mode closes). */
function pageAfterCleanup(pages: HomePages, index: number): number {
  const before = pages.slice(0, index).filter((page) => page.length > 0).length;
  return pages[index]?.length ? before : Math.max(0, before - 1);
}

/**
 * The Início as the home screen of a phone: telas of widgets side by side (swipe between them; the
 * squares above "Apps" say how many there are and which one is open), an up-arrow at the bottom
 * that brings up the app drawer (what used to be the "Mais" tab), and the floating buttons of the
 * month right above it.
 *
 * Edit mode (the pencil, or a long press on empty space) works like a phone's: the telas shrink so
 * the neighbours show; a widget is held and then dragged — to another place, to the edge to go to
 * the tela next door (past the last one, a new tela), or onto the widget tray to leave the Início;
 * the tray, where the up-arrow was, puts widgets back; and every change is saved straight away
 * (on screen first, undone with an error message if the save fails).
 */
export function HomeScreen({ settings, openApps }: { settings: BudgetSettings; openApps: boolean }) {
  const { month } = useMonthContext();
  const { saveSettings } = useSettings();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { startSteps } = useTour();
  const pathname = usePathname();

  const [layout, setLayout] = useState<HomeLayout>(() => ({
    pages: resolveHomePages(settings),
    hidden: settings.homeHidden ?? [],
    sizes: settings.homeCardSizes ?? {},
  }));
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(getSessionHomePage);
  const [trayOpen, setTrayOpen] = useState(false);
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  /** The widget whose "Mover" sheet is open. */
  const [moving, setMoving] = useState<HomeWidgetKey | null>(null);

  const desk = useRef<HomeDeskHandle>(null);
  const drawer = useRef<AppDrawerHandle>(null);
  const appsButton = useRef<HTMLButtonElement>(null);
  const trayBar = useRef<HTMLButtonElement>(null);

  // Every widget the modules that are on can show — on an tela or in the tray. One `HomeCardsData`
  // for all of them: one read of the wallet and of the reminders for every tela.
  const available = homeCards(settings);
  // Shown: the pages as arranged, kept in step with the modules (a widget of a module just turned
  // on comes in, one turned off goes). In edit mode, exactly what is being edited, empty telas too.
  const pages = editing
    ? layout.pages
    : resolveHomePages({
        modules: settings.modules,
        homePages: layout.pages,
        homeHidden: layout.hidden,
      });
  const canAddPage = editing && pages.length < MAX_HOME_PAGES;
  const count = pages.length + (canAddPage ? 1 : 0);
  const shown = Math.max(0, Math.min(current, count - 1));
  // The widget the "Como organizar" tour points at: the first of the tela on screen, or of the
  // first tela that has any.
  const tourPage = pages[shown]?.length ? shown : pages.findIndex((page) => page.length > 0);
  const areasHint = useOneTimeHint(AREAS_HINT, { when: !editing && pages.length > 1 });
  // Swiping to another tela is the thing the hint explains: done, it goes.
  const dismissAreasHint = areasHint.dismiss;
  const firstPage = useRef(shown);
  useEffect(() => {
    if (shown !== firstPage.current) dismissAreasHint();
  }, [shown, dismissAreasHint]);
  const appsLearned = settings.dismissedNotices?.includes(APPS_HINT) ?? false;

  const hidden = hiddenHomeCards({
    modules: settings.modules,
    homeHidden: layout.hidden,
  });
  const withActions = isModuleOn(settings, 'expenses');

  // What the window listeners and dnd-kit's callbacks read between renders.
  const layoutRef = useRef(layout);
  const shownRef = useRef(shown);
  const dragRef = useRef<ActiveDrag | null>(null);
  const settingsRef = useRef(settings);
  const trayOpenRef = useRef(trayOpen);
  useLayoutEffect(() => {
    layoutRef.current = layout;
    shownRef.current = shown;
    settingsRef.current = settings;
    trayOpenRef.current = trayOpen;
  });

  useEffect(() => {
    setSessionHomePage(shown);
  }, [shown]);

  /** Shows `next` straight away and saves it; a failed save puts `previous` back. */
  const save = useCallback(
    async (next: HomeLayout, previous: HomeLayout, options: { asDefault?: boolean } = {}) => {
      setLayout(next);
      try {
        await saveSettings({
          ...settingsRef.current,
          homePages: options.asDefault ? null : next.pages,
          // Only the pages are written from now on; the single list of before is left empty.
          homeOrder: null,
          homeHidden: next.hidden,
          homeCardSizes: next.sizes,
        });
        return true;
      } catch {
        setLayout(previous);
        showToast('Não foi possível salvar a Início. Tente de novo.', 'error');
        return false;
      }
    },
    [saveSettings, showToast],
  );

  // ---------------------------------------------------------------------------------------------
  // Edit mode
  // ---------------------------------------------------------------------------------------------

  const editEntry = useRef<string | null>(null);

  function enterEdit(withTray = false) {
    // From what is on screen: the widgets of a module turned on since are already in place.
    setLayout((previous) => ({
      ...previous,
      pages: resolveHomePages({
        modules: settings.modules,
        homePages: previous.pages,
        homeHidden: previous.hidden,
      }),
    }));
    setEditing(true);
    if (withTray) setTrayOpen(true);
  }

  /** Leaves edit mode; the empty telas go (and the page on screen follows what is left). */
  const finishEdit = useCallback(() => {
    const now = layoutRef.current;
    setEditing(false);
    setTrayOpen(false);
    setMoving(null);
    setCurrent(pageAfterCleanup(now.pages, shownRef.current));
    const cleaned = withoutEmptyPages(now.pages);
    if (cleaned.length !== now.pages.length) void save({ ...now, pages: cleaned }, now);
  }, [save]);

  /** "Como organizar a Início" (the ? by the pencil): edit mode first, then the tour over its controls. */
  const organizeTourPending = useRef(false);
  const startOrganizeTour = useCallback(
    () => startSteps(homeEditTourSteps(`${window.location.pathname}${window.location.search}`)),
    [startSteps],
  );

  function showHowToOrganize() {
    setTrayOpen(false);
    if (editing) return startOrganizeTour();
    organizeTourPending.current = true;
    enterEdit();
  }

  // Once the edit-mode controls are on screen, the spotlight can find them.
  useEffect(() => {
    if (!editing || !organizeTourPending.current) return;
    organizeTourPending.current = false;
    startOrganizeTour();
  }, [editing, startOrganizeTour]);

  function doneEditing() {
    if (editEntry.current) popSheetEntry(editEntry.current);
    editEntry.current = null;
    finishEdit();
  }

  // In edit mode the phone's back button first closes the widget tray, then leaves edit mode —
  // never the screen. One history entry for both: closing the tray puts a fresh one back.
  useEffect(() => {
    if (!editing) return;
    editEntry.current = pushSheetEntry();
    return registerSheet({
      get entry() {
        return editEntry.current ?? '';
      },
      onBack: () => {
        if (trayOpenRef.current) {
          setTrayOpen(false);
          editEntry.current = pushSheetEntry();
        } else {
          editEntry.current = null;
          finishEdit();
        }
      },
    });
  }, [editing, finishEdit]);

  function removeFromHome(key: HomeWidgetKey) {
    const previous = layout;
    void save(
      {
        ...previous,
        pages: removeWidget(previous.pages, key),
        hidden: [...previous.hidden.filter((item) => item !== key), key],
      },
      previous,
    );
  }

  /** Puts a widget at the end of tela `page` (one past the last: a new tela) and says where. */
  function placeWidget(key: HomeWidgetKey, page: number) {
    const previous = layoutRef.current;
    const pagesNext = addWidget(previous.pages, key, page);
    const landed = pageOfWidget(pagesNext, key);
    if (landed === -1) return;
    void save(
      { ...previous, pages: pagesNext, hidden: previous.hidden.filter((item) => item !== key) },
      previous,
    );
    showToast(`${widgetName(key)} foi para a tela ${landed + 1}.`);
  }

  function toggleSize(key: HomeWidgetKey) {
    const previous = layout;
    const next: 'half' | 'full' = (previous.sizes[key] ?? 'half') === 'half' ? 'full' : 'half';
    void save({ ...previous, sizes: { ...previous.sizes, [key]: next } }, previous);
  }

  function createPage() {
    const previous = layout;
    const next = addHomePage(previous.pages);
    if (!next) {
      showToast(`Dá para ter até ${MAX_HOME_PAGES} telas.`, 'info');
      return;
    }
    setCurrent(next.length - 1);
    void save({ ...previous, pages: next }, previous);
  }

  /** Deletes a tela; its widgets go to the tela next to it (only the "−" takes one off). */
  async function deletePage(index: number) {
    const widgets = layout.pages[index] ?? [];
    if (widgets.length > 0) {
      // Where they go, numbered as the telas are now: the one before, or the next for the first.
      const neighbour = (index > 0 ? index - 1 : index + 1) + 1;
      const confirmed = await confirm({
        title: `Excluir a tela ${index + 1}?`,
        message:
          widgets.length === 1
            ? `${widgetName(widgets[0])} vai para a tela ${neighbour}.`
            : `Os ${widgets.length} widgets dela vão para a tela ${neighbour}.`,
        confirmLabel: 'Excluir tela',
        destructive: true,
      });
      if (!confirmed) return;
    }
    const previous = layoutRef.current;
    const { pages: next, movedTo } = deleteHomePage(previous.pages, index);
    const on = shownRef.current;
    setCurrent(
      movedTo !== -1 && on === index ? movedTo : on > index ? on - 1 : Math.min(on, next.length - 1),
    );
    void save({ ...previous, pages: next }, previous);
  }

  /** Back to the Início every new account gets (the template's), or the default order without one. */
  async function restoreDefault() {
    const confirmed = await confirm({
      title: 'Voltar ao padrão?',
      message: 'A Início fica como a de quem acabou de chegar.',
      confirmLabel: 'Voltar ao padrão',
    });
    if (!confirmed) return;
    let template;
    try {
      template = await fetchHomeTemplate();
    } catch {
      showToast('Não foi possível voltar ao padrão. Tente de novo.', 'error');
      return;
    }
    const previous = layoutRef.current;
    setCurrent(0);
    setTrayOpen(false);
    // Every widget back, in the template's places (only a restricted module's stays out, by itself).
    const next = {
      pages: template?.homePages ?? [homeCards(settingsRef.current)],
      hidden: [],
      sizes: template?.homeCardSizes ?? {},
    };
    const ok = await save(next, previous, { asDefault: !template?.homePages });
    if (ok) showToast('A Início voltou ao padrão.');
  }

  // ---------------------------------------------------------------------------------------------
  // Dragging widgets (edit mode)
  // ---------------------------------------------------------------------------------------------

  // Hold, then drag — never drag straight away: a widget only comes loose after the finger has
  // stayed on it, so brushing past one never moves anything, and until then the finger scrolls
  // the tela (or swipes to the next one) as usual.
  //
  // The touch half is deliberately the `TouchSensor` and not the `PointerSensor`: the pointer one
  // can only stop the page from scrolling under the finger with `touch-action: none`, which would
  // leave edit mode impossible to scroll. The touch sensor blocks the scroll from inside, once the
  // widget is really loose — which is how a phone's home screen behaves.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: HOLD_MS, tolerance: HOLD_TOLERANCE } }),
    useSensor(TouchSensor, { activationConstraint: { delay: HOLD_MS, tolerance: HOLD_TOLERANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** The layout before the drag started: what a cancelled drag goes back to. */
  const beforeDrag = useRef<HomeLayout | null>(null);
  const edge = useRef<{ side: -1 | 0 | 1; timer: number | null }>({ side: 0, timer: null });

  const stopEdgeHold = () => {
    if (edge.current.timer !== null) window.clearTimeout(edge.current.timer);
    edge.current = { side: 0, timer: null };
  };

  // Only what is on the tela on screen can be under the widget: the neighbours, offscreen or
  // peeking at the edges, never are. Dropping never takes a widget off the Início — only its "−"
  // does —, so the tray's bar only matters to a widget picked up from the tray itself: let go
  // there, it stays in the tray. The bar is checked where it is right now (it slides down when the
  // drag starts), under the finger.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const bar = trayBar.current?.getBoundingClientRect();
    const finger = args.pointerCoordinates;
    const fromTray = widgetOfTrayDrag(args.active.id) !== null;
    if (fromTray && bar && finger && finger.y >= bar.top && finger.x >= bar.left && finger.x <= bar.right) {
      return [{ id: TRAY_ID }];
    }
    const page = shownRef.current;
    const keys = layoutRef.current.pages[page] ?? [];
    const items = args.droppableContainers.filter((container) =>
      keys.includes(container.id as HomeWidgetKey),
    );
    if (items.length > 0) return closestCenter({ ...args, droppableContainers: items });
    return args.droppableContainers.some((container) => container.id === pageId(page))
      ? [{ id: pageId(page) }]
      : [];
  }, []);

  function handleDragStart({ active }: DragStartEvent) {
    const fromTray = widgetOfTrayDrag(active.id);
    const next: ActiveDrag = {
      widget: fromTray ?? (active.id as HomeWidgetKey),
      fromTray: fromTray !== null,
    };
    beforeDrag.current = layoutRef.current;
    dragRef.current = next;
    setDrag(next);
    // Out of the way: the telas are where the widget goes.
    setTrayOpen(false);
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over || over.id === TRAY_ID) return;
    const widget = widgetOfId(active.id);
    const fromTray = widgetOfTrayDrag(active.id) !== null;
    if (over.id === widget) return;
    setLayout((previous) => {
      const overPage = pageOfId(over.id);
      const page = overPage ?? pageOfWidget(previous.pages, over.id as HomeWidgetKey);
      if (page < 0) return previous;
      const from = pageOfWidget(previous.pages, widget);
      // Within its own tela a widget of the tela is sorted by dnd-kit itself (see `handleDragEnd`);
      // one coming from the tray, or from another tela, is moved here so it shows where it would land.
      if (!fromTray && from === page) return previous;
      const target = previous.pages[page];
      const index = overPage !== null ? target.length : target.indexOf(over.id as HomeWidgetKey);
      if (from === page && target.indexOf(widget) === index) return previous;
      return { ...previous, pages: moveWidget(previous.pages, widget, page, index) };
    });
  }

  /** Held at an edge: the widget goes to the tela on that side (past the last, a new one). */
  function flipPage(side: -1 | 1): boolean {
    const active = dragRef.current;
    const now = layoutRef.current;
    // From the "new tela" slot (one past the last), going on creates the tela right there.
    const target = Math.min(shownRef.current + side, now.pages.length);
    if (!active || target < 0) return false;
    if (target >= now.pages.length && now.pages.length >= MAX_HOME_PAGES) {
      showToast(`Dá para ter até ${MAX_HOME_PAGES} telas.`, 'info');
      return false;
    }
    const length =
      target < now.pages.length ? now.pages[target].filter((key) => key !== active.widget).length : 0;
    setLayout({ ...now, pages: moveWidget(now.pages, active.widget, target, length) });
    setCurrent(target);
    return true;
  }

  function handleDragMove({ activatorEvent, delta }: DragMoveEvent) {
    const start = getEventCoordinates(activatorEvent);
    const area = desk.current?.viewport()?.getBoundingClientRect();
    if (!start || !area) return;
    const x = start.x + delta.x;
    const side = x < area.left + EDGE_ZONE ? -1 : x > area.right - EDGE_ZONE ? 1 : 0;
    if (side === edge.current.side) return;
    stopEdgeHold();
    if (side === 0) return;
    const hold = () => {
      edge.current.timer = flipPage(side) ? window.setTimeout(hold, EDGE_HOLD_MS) : null;
    };
    edge.current = { side, timer: window.setTimeout(hold, EDGE_HOLD_MS) };
  }

  function endDrag() {
    stopEdgeHold();
    dragRef.current = null;
    beforeDrag.current = null;
    setDrag(null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const widget = widgetOfId(active.id);
    const fromTray = widgetOfTrayDrag(active.id) !== null;
    const before = beforeDrag.current ?? layoutRef.current;
    let next = layoutRef.current;
    endDrag();

    if (fromTray) {
      // Dropped back on the tray, or nowhere: nothing changes.
      if (!over || over.id === TRAY_ID || pageOfWidget(next.pages, widget) === -1) {
        setLayout(before);
        return;
      }
      next = { ...next, hidden: next.hidden.filter((key) => key !== widget) };
      void save(next, before);
      showToast(`${widgetName(widget)} foi para a tela ${pageOfWidget(next.pages, widget) + 1}.`);
      return;
    }

    // Wherever it is let go, a widget of an tela stays on the Início (only its "−" takes it off).
    if (over && over.id !== widget && over.id !== TRAY_ID && pageOfId(over.id) === null) {
      const page = pageOfWidget(next.pages, widget);
      const to = page === -1 ? -1 : next.pages[page].indexOf(over.id as HomeWidgetKey);
      if (to !== -1) next = { ...next, pages: moveWidget(next.pages, widget, page, to) };
    }
    if (JSON.stringify(next) !== JSON.stringify(before)) void save(next, before);
    else setLayout(before);
  }

  function handleDragCancel() {
    const before = beforeDrag.current;
    endDrag();
    if (before) setLayout(before);
  }

  const nameOf = (id: UniqueIdentifier) => {
    const page = pageOfId(id);
    return page !== null ? `a tela ${page + 1}` : widgetName(widgetOfId(id));
  };
  const whereIs = (id: UniqueIdentifier) => {
    const page = pageOfId(id) ?? pageOfWidget(layoutRef.current.pages, widgetOfId(id));
    return page >= 0 ? `na tela ${page + 1}` : 'na bandeja de widgets';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Você pegou ${nameOf(active.id)}, ${whereIs(active.id)}.`,
    onDragOver: ({ active, over }) =>
      !over
        ? `${nameOf(active.id)} está fora das telas.`
        : over.id === TRAY_ID
          ? `${nameOf(active.id)} está sobre a bandeja de widgets. Solte para deixar lá.`
          : pageOfId(over.id) !== null
            ? `${nameOf(active.id)} está ${whereIs(over.id)}.`
            : `${nameOf(active.id)} está sobre ${nameOf(over.id)}, ${whereIs(over.id)}.`,
    onDragEnd: ({ active, over }) =>
      !over
        ? `${nameOf(active.id)} foi solto e voltou para onde estava.`
        : over.id === TRAY_ID
          ? `${nameOf(active.id)} continua na bandeja de widgets.`
          : `${nameOf(active.id)} foi solto ${whereIs(active.id)}.`,
    onDragCancel: ({ active }) => `Arraste cancelado. ${nameOf(active.id)} voltou para onde estava.`,
  };

  // ---------------------------------------------------------------------------------------------
  // The tour and old links
  // ---------------------------------------------------------------------------------------------

  // A tour step on a widget: switch to the tela that has it, and scroll it into view — right
  // now, so the spotlight that comes next measures it in place.
  useLayoutEffect(
    () =>
      subscribeHomeReveal((anchor) => {
        const handle = desk.current;
        if (!handle) return;
        for (let index = 0; index < layoutRef.current.pages.length; index += 1) {
          const page = handle.page(index);
          const target = page?.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
          if (!page || !target) continue;
          handle.jump(index);
          setCurrent(index);
          const box = page.getBoundingClientRect();
          const spot = target.getBoundingClientRect();
          page.scrollTop += spot.top - box.top - Math.max(0, (box.height - spot.height) / 2);
          return;
        }
      }),
    [],
  );

  /** The drawer was found: the up-arrow can stop hopping, for good. */
  const learnApps = useCallback(() => {
    const current = settingsRef.current;
    if (current.dismissedNotices?.includes(APPS_HINT)) return;
    void saveSettings({
      ...current,
      dismissedNotices: [...(current.dismissedNotices ?? []), APPS_HINT],
    }).catch(() => {});
  }, [saveSettings]);

  // An old link to /mais: the drawer comes up straight away, and the address loses the "?apps".
  useEffect(() => {
    if (!openApps) return;
    window.history.replaceState(null, '', pathname);
    drawer.current?.open();
  }, [openApps, pathname]);

  // ---------------------------------------------------------------------------------------------

  const renderPage = (index: number) => {
    if (editing && index === pages.length) {
      return (
        <div className="flex h-full p-4">
          <button
            type="button"
            onClick={createPage}
            className="border-primary/50 text-primary hover:bg-primary/5 flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed font-semibold"
          >
            <Plus aria-hidden className="h-8 w-8" />
            Nova tela
          </button>
        </div>
      );
    }
    const widgets = pages[index] ?? [];
    if (editing) {
      return (
        <EditablePage
          index={index}
          widgets={widgets}
          pageCount={pages.length}
          sizes={layout.sizes}
          tourAnchor={index === tourPage}
          ghost={drag?.fromTray ? drag.widget : null}
          onRemove={removeFromHome}
          onToggleSize={toggleSize}
          onMove={setMoving}
          onDelete={() => void deletePage(index)}
        />
      );
    }
    return (
      <div className={`flex flex-col gap-4 px-4 pt-3 ${withActions ? 'pb-32' : 'pb-6'}`}>
        {widgets.length === 0 ? (
          <EmptyState
            icon={<IconTile icon={LayoutGrid} tone="neutral" size="lg" />}
            title="Nenhum widget na Início"
            text="Você tirou todos. Escolha quais quer ver por aqui."
            action={
              <button type="button" onClick={() => enterEdit(true)} className={EMPTY_ACTION}>
                Adicionar widgets
              </button>
            }
          />
        ) : (
          <HomeCards keys={widgets} sizes={layout.sizes} />
        )}
      </div>
    );
  };

  return (
    <HomeCardsData keys={available}>
      <div
        // Nothing may scroll the screen itself (a tour spotlight bringing something into view could,
        // and it would stay shifted up): only the telas inside scroll.
        onScroll={(event) => {
          if (event.currentTarget.scrollTop !== 0) event.currentTarget.scrollTop = 0;
        }}
        className="relative flex h-dvh flex-col overflow-hidden"
      >
        <header className="relative z-20 flex shrink-0 flex-col gap-2 px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            {editing ? (
              <button
                type="button"
                onClick={() => void restoreDefault()}
                className="border-border text-foreground hover:bg-card flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors"
              >
                <RotateCcw aria-hidden className="h-4 w-4" />
                Voltar ao padrão
              </button>
            ) : (
              <GreetingHeader />
            )}
            <div className="flex items-center gap-1">
              {available.length > 0 && (
                <button
                  type="button"
                  onClick={showHowToOrganize}
                  data-tour={HOME_HELP_ANCHOR}
                  aria-label="Como organizar a Início"
                  title="Como organizar a Início"
                  className="text-muted hover:text-foreground hover:bg-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
                >
                  <CircleHelp aria-hidden className="h-5 w-5" />
                </button>
              )}
              {available.length > 0 && (
                <button
                  type="button"
                  onClick={() => (editing ? doneEditing() : enterEdit())}
                  data-tour={editing ? 'inicio-concluir' : undefined}
                  aria-label={editing ? 'Concluir a edição da Início' : 'Editar a Início'}
                  title={editing ? 'Concluído' : 'Editar a Início'}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                    editing
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground hover:bg-card'
                  }`}
                >
                  {editing ? (
                    <Check aria-hidden className="h-5 w-5" />
                  ) : (
                    <Pencil aria-hidden className="h-5 w-5" />
                  )}
                </button>
              )}
              <NotificationBell />
            </div>
          </div>
          {!editing && <MissionsBar />}
          {areasHint.visible && (
            <p
              role="status"
              className="bg-card text-foreground border-border pointer-events-none absolute top-full left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap shadow-lg"
            >
              <ArrowLeftRight aria-hidden className="text-primary motion-safe:animate-sway h-4 w-4" />
              Deslize para o lado para ver a outra tela
            </p>
          )}
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          measuring={MEASURING}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'Para pegar um widget, aperte espaço ou Enter. Com ele pego, use as setas para mudar de lugar, espaço ou Enter para soltar e Esc para cancelar. O botão Mover leva para outra tela.',
            },
          }}
        >
          <HomeDesk
            ref={desk}
            count={count}
            current={shown}
            editing={editing}
            label={(index) => (index === pages.length ? 'Nova tela' : `Tela ${index + 1} de ${pages.length}`)}
            onChange={setCurrent}
            isBlocked={() => dragRef.current !== null}
            onLongPress={available.length > 0 ? () => enterEdit() : undefined}
            renderPage={renderPage}
          />
          <RemeasureAfterSlide page={shown} />

          <div
            className="relative flex shrink-0 flex-col"
            style={{
              height: `calc(${editing ? TRAY_BAR_HEIGHT : HOME_FOOTER_HEIGHT} + env(safe-area-inset-bottom))`,
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <PageDots pages={pages.length} current={shown} withNewPage={canAddPage} onSelect={setCurrent} />
            {!editing && <AppsHandle drawer={drawer} buttonRef={appsButton} hop={!appsLearned} />}
          </div>

          {editing && (
            <WidgetTray
              open={trayOpen}
              onOpenChange={setTrayOpen}
              hidden={hidden}
              sizes={layout.sizes}
              trayDrag={drag?.fromTray ?? false}
              dragActive={drag !== null}
              onAdd={(key) => placeWidget(key, shown)}
              onRestoreDefault={() => void restoreDefault()}
              barRef={trayBar}
            />
          )}

          <DragOverlay>
            {drag ? (
              drag.fromTray ? (
                <TrayChip widget={drag.widget} />
              ) : (
                <div className="pointer-events-none scale-[1.03] rounded-2xl opacity-95 shadow-2xl">
                  <Card moduleKey={drag.widget} />
                </div>
              )
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {withActions && !editing && <MonthActions placement="home" />}

      <AppDrawer
        ref={drawer}
        month={month}
        onOpened={learnApps}
        onClosed={() => appsButton.current?.focus({ preventScroll: true })}
      />

      {moving && (
        <BottomSheet open title={`Mover ${widgetName(moving)}`} onClose={() => setMoving(null)}>
          <MoveOptions
            pages={layout.pages}
            widget={moving}
            onPick={(page) => {
              setMoving(null);
              placeWidget(moving, page);
            }}
          />
        </BottomSheet>
      )}
    </HomeCardsData>
  );
}

const EMPTY_ACTION =
  'bg-primary text-primary-foreground flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold';

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <div className="border-border bg-card flex flex-col items-center gap-3 rounded-2xl border p-6 text-center shadow-sm">
      {icon}
      <p className="text-foreground font-semibold">{title}</p>
      <p className="text-muted text-sm">{text}</p>
      {action}
    </div>
  );
}

/** One tela in edit mode: its name and the button to delete it, then its widgets, sortable. */
function EditablePage({
  index,
  widgets,
  pageCount,
  sizes,
  tourAnchor,
  ghost,
  onRemove,
  onToggleSize,
  onMove,
  onDelete,
}: {
  index: number;
  widgets: HomeWidgetKey[];
  pageCount: number;
  sizes: Sizes;
  /** Its first widget is the one the "Como organizar" tour points at. */
  tourAnchor: boolean;
  /** A widget from the tray, shown faded where it would land. */
  ghost: HomeWidgetKey | null;
  onRemove: (key: HomeWidgetKey) => void;
  onToggleSize: (key: HomeWidgetKey) => void;
  onMove: (key: HomeWidgetKey) => void;
  onDelete: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: pageId(index) });

  return (
    <div className="flex min-h-full flex-col gap-3 px-4 pt-3 pb-6">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <p className="text-muted text-xs font-semibold tracking-wide uppercase">Tela {index + 1}</p>
        {pageCount > 1 && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Excluir a tela ${index + 1}`}
            className="text-muted hover:text-danger hover:bg-danger-bg flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            Excluir tela
          </button>
        )}
      </div>
      <SortableContext id={pageId(index)} items={widgets} strategy={rectSortingStrategy}>
        <div ref={setNodeRef} className="grid flex-1 grid-cols-2 content-start gap-3">
          {widgets.map((key, position) => (
            <EditableWidget
              key={key}
              widget={key}
              tourAnchor={tourAnchor && position === 0}
              size={effectiveSize(key, sizes) ?? 'half'}
              resizable={RESIZABLE_HOME_CARDS.includes(key)}
              ghost={ghost === key}
              onToggleSize={() => onToggleSize(key)}
              onRemove={() => onRemove(key)}
              onMove={() => onMove(key)}
            />
          ))}
          {widgets.length === 0 && (
            <p className="border-border text-muted col-span-2 rounded-2xl border-2 border-dashed p-6 text-center text-sm">
              Tela vazia. Arraste um widget para cá.
            </p>
          )}
        </div>
      </SortableContext>
      <p className="text-muted pt-2 text-center text-xs">
        Segure e arraste para mudar de lugar; o − tira da Início. Toque em{' '}
        <Check aria-hidden className="inline h-3.5 w-3.5 align-text-bottom" /> quando terminar.
      </p>
    </div>
  );
}

/** "Mover para": the telas (and a new one), for moving a widget without dragging it. */
function MoveOptions({
  pages,
  widget,
  onPick,
}: {
  pages: HomePages;
  widget: HomeWidgetKey;
  onPick: (page: number) => void;
}) {
  const here = pageOfWidget(pages, widget);
  const option =
    'border-border bg-background hover:border-primary/40 flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border px-4 text-left text-sm font-medium disabled:opacity-60';
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted text-sm">Mover para:</p>
      {pages.map((page, index) => (
        <button
          key={index}
          type="button"
          disabled={index === here}
          onClick={() => onPick(index)}
          className={option}
        >
          <span className="text-foreground">Tela {index + 1}</span>
          <span className="text-muted text-xs">
            {index === here ? 'Está aqui' : `${page.length} ${page.length === 1 ? 'widget' : 'widgets'}`}
          </span>
        </button>
      ))}
      {pages.length < MAX_HOME_PAGES && (
        <button type="button" onClick={() => onPick(pages.length)} className={option}>
          <span className="text-primary flex items-center gap-2 font-semibold">
            <Plus aria-hidden className="h-4 w-4" />
            Nova tela
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * The little squares right above "Apps", always there — even with one tela: how many telas the
 * Início has, which one is open (the less see-through one), and a tap to go to another. They
 * float over the bottom of the áreas, see-through and with nothing behind them, like a phone's.
 */
function PageDots({
  pages,
  current,
  withNewPage,
  onSelect,
}: {
  pages: number;
  current: number;
  withNewPage: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Telas"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 flex h-6 -translate-x-1/2 items-center justify-center gap-0.5 [&>button]:pointer-events-auto"
    >
      {Array.from({ length: pages }, (_, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onSelect(index)}
          aria-label={`Tela ${index + 1} de ${pages}`}
          aria-current={index === current ? 'true' : undefined}
          className="flex h-6 w-6 items-center justify-center"
        >
          <span
            aria-hidden
            className={`block h-2 w-2 rounded-[2px] transition-colors duration-200 ${
              index === current ? 'bg-foreground/60' : 'bg-foreground/20'
            }`}
          />
        </button>
      ))}
      {withNewPage && (
        <button
          type="button"
          onClick={() => onSelect(pages)}
          aria-label="Nova tela"
          aria-current={current === pages ? 'true' : undefined}
          className={`flex h-6 w-6 items-center justify-center ${current === pages ? 'text-foreground/60' : 'text-foreground/30'}`}
        >
          <Plus aria-hidden className="h-3 w-3" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/**
 * The up-arrow, with "Apps" under it: a tap (or Enter) opens the app drawer, and a drag up from
 * anywhere on its strip brings the drawer up with the finger — it opens past a quarter of the
 * screen or on a flick. Until the drawer has been opened once (`hop`), it hops a few times each
 * time the Início shows, so a new person sees there is something there.
 */
function AppsHandle({
  drawer,
  buttonRef,
  hop,
}: {
  drawer: RefObject<AppDrawerHandle | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  hop: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const { wasDragged } = useVerticalDrag(strip, {
    direction: 'up',
    onMove: (distance) => {
      const height = drawer.current?.height() ?? window.innerHeight;
      drawer.current?.follow(Math.max(0, height - distance));
    },
    onEnd: (distance, speed) => {
      const height = drawer.current?.height() ?? window.innerHeight;
      drawer.current?.settle(drawerCommits(distance, height, speed));
    },
  });

  return (
    <div ref={strip} className="flex min-h-0 flex-1 items-center justify-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!wasDragged()) drawer.current?.open();
        }}
        aria-label="Abrir todos os apps"
        aria-haspopup="dialog"
        title="Todos os apps"
        className="text-muted hover:text-foreground flex h-12 w-24 items-center justify-center rounded-full transition-colors"
      >
        <span className={`flex flex-col items-center ${hop ? 'motion-safe:animate-apps-hop' : ''}`}>
          <ChevronUp aria-hidden className="h-6 w-6" />
          <span aria-hidden className="text-[11px] leading-none font-semibold">
            Apps
          </span>
        </span>
      </button>
    </div>
  );
}

/** What follows the finger while a widget comes out of the tray. */
function TrayChip({ widget }: { widget: HomeWidgetKey }) {
  const visual = widgetVisual(widget);
  return (
    <div className="border-primary/60 bg-card flex items-center gap-3 rounded-xl border-2 p-3 shadow-2xl">
      <IconTile icon={visual.icon} tone={visual.tone} />
      <span className="text-foreground font-medium">{widgetName(widget)}</span>
    </div>
  );
}

/**
 * After the track slides to another tela mid-drag, dnd-kit's measurements of where everything is
 * are stale (the widgets moved without being re-rendered): measure again once it has arrived.
 */
function RemeasureAfterSlide({ page }: { page: number }) {
  const context = useDndContext();
  const latest = useRef(context);
  useEffect(() => {
    latest.current = context;
  });
  useEffect(() => {
    if (!latest.current.active) return;
    const timer = window.setTimeout(() => {
      const { droppableContainers, measureDroppableContainers } = latest.current;
      measureDroppableContainers(Array.from(droppableContainers.keys()));
    }, IN_MS + 20);
    return () => window.clearTimeout(timer);
  }, [page]);
  return null;
}
