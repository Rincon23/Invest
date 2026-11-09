'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { formatMonthLabel, shiftMonth, type Month } from '@/lib/budget';
import {
  BACK_MS,
  EASE,
  FlickMeter,
  IN_MS,
  LOCK_DISTANCE,
  MIN_RATIO,
  insideExcludedArea,
  swipeCommits,
} from '@/components/layout/swipePhysics';

/** Space between the month on screen and the one coming in, as between two áreas of the Início. */
const GAP = 16;
/** How long after a swipe a click is still the swipe's, not a tap (a mouse clicks where it lets go). */
const SWALLOW_CLICK_MS = 400;
/** If the other month has not taken over by then (no connection?), the screen slides back. */
const GIVE_UP_MS = 10_000;

/** +1 is the next month, −1 the one before. */
type Step = 1 | -1;

const MonthSwipeContext = createContext<((step: Step) => void) | null>(null);

/** Inside a `MonthSwipe`, slides to the month before or after — what the ‹ › of the switcher do. */
export function useMonthSwipe(): ((step: Step) => void) | null {
  return useContext(MonthSwipeContext);
}

interface Drag {
  id: number;
  x: number;
  y: number;
  locked: boolean;
  dropped: boolean;
  meter: FlickMeter;
}

/** Something is on top of the screen (a sheet, a dialog, the tour): the swipe is not for it. */
function screenCovered(): boolean {
  return (
    document.querySelector('[role="dialog"]') !== null || document.body.classList.contains('driver-active')
  );
}

/** Where the visible part of the screen starts: under its sticky header, if it has one. */
function visibleTop(): number {
  let top = 0;
  document.querySelectorAll('header').forEach((header) => {
    if (getComputedStyle(header).position === 'sticky')
      top = Math.max(top, header.getBoundingClientRect().bottom);
  });
  return top;
}

/**
 * The month of a screen (Lançamentos, Gastos por categoria, the card bill) changed by swiping
 * sideways, with the physics of the áreas of the Início (`swipePhysics.ts`): the month follows the
 * finger, springs back on a short drag, and past 30% of the width or on a flick slides out while
 * the next one comes in from the other side — to the left is the next month, to the right the one
 * before. The ‹ › of the switcher inside slide the same way (`useMonthSwipe`).
 *
 * The month coming in shows its name and "Carregando…" — what its screen shows while it loads —
 * until `onMonth` has put it on screen. The whole screen swipes, header and empty space included.
 * Up and down stay the browser's (`touch-action: pan-y`, on the body too); strips that scroll
 * sideways, text fields and anything with `data-no-swipe-nav` keep their own gesture, and nothing
 * swipes while a sheet or the tour is open.
 */
export function MonthSwipe({
  month,
  onMonth,
  min,
  max,
  className = '',
  children,
}: {
  month: Month;
  /** Puts the other month on screen (a route of that month, or the screen's own state). */
  onMonth: (month: Month) => void;
  /** The first and last months the screen has (none: any): past them, a swipe springs back. */
  min?: Month;
  max?: Month;
  className?: string;
  children: ReactNode;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  /** Sliding out, or waiting for the other month: no new gesture until it is on screen. */
  const busy = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const giveUpTimer = useRef<number | null>(null);

  // The window listeners (attached once) read the latest props through this.
  const latest = useRef({ month, onMonth, min, max });
  useEffect(() => {
    latest.current = { month, onMonth, min, max };
  });
  const within = (target: Month) => (!min || target >= min) && (!max || target <= max);

  function clearTimers() {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    if (giveUpTimer.current !== null) window.clearTimeout(giveUpTimer.current);
    settleTimer.current = null;
    giveUpTimer.current = null;
  }

  /** Back to rest: no transform left behind, so sheets inside stay fixed to the screen. */
  function rest(el: HTMLElement) {
    el.style.transition = '';
    el.style.transform = '';
    el.style.willChange = '';
    el.style.userSelect = '';
  }

  /** Puts the two months waiting at the sides level with what is on screen. */
  function placeGhosts(el: HTMLElement) {
    const top = el.getBoundingClientRect().top;
    const visible = visibleTop();
    const offset = top >= visible ? 0 : visible - top + 12;
    el.querySelectorAll<HTMLElement>(':scope > [data-month-ghost]').forEach((ghost) => {
      ghost.style.top = `${offset}px`;
    });
  }

  function springBack() {
    const el = wrapper.current;
    if (!el) return;
    clearTimers();
    el.style.transition = `transform ${BACK_MS}ms ${EASE}`;
    el.style.transform = 'translate3d(0, 0, 0)';
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      busy.current = false;
      rest(el);
    }, BACK_MS);
  }

  /** Slides the month out to one side, the next one in from the other, then hands over. */
  function slideTo(step: Step) {
    const el = wrapper.current;
    if (!el) return;
    const { month: current, min: first, max: last } = latest.current;
    const next = shiftMonth(current, step);
    // The screen has no month there: back to rest, like a short drag.
    if ((first && next < first) || (last && next > last)) {
      springBack();
      return;
    }
    busy.current = true;
    clearTimers();
    placeGhosts(el);
    el.style.willChange = 'transform';
    el.style.transition = `transform ${IN_MS}ms ${EASE}`;
    el.style.transform = `translate3d(${-step * (el.clientWidth + GAP)}px, 0, 0)`;
    const target = shiftMonth(latest.current.month, step);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      latest.current.onMonth(target);
      giveUpTimer.current = window.setTimeout(springBack, GIVE_UP_MS);
    }, IN_MS);
  }

  const actions = useRef({ springBack, slideTo, placeGhosts });
  useEffect(() => {
    actions.current = { springBack, slideTo, placeGhosts };
  });

  // The other month is on screen: this one comes back to rest, at its top.
  const shown = useRef(month);
  useLayoutEffect(() => {
    if (shown.current === month) return;
    shown.current = month;
    const el = wrapper.current;
    if (!el || !busy.current) return;
    clearTimers();
    busy.current = false;
    rest(el);
    const top = el.getBoundingClientRect().top;
    const visible = visibleTop();
    if (top < visible) window.scrollBy({ top: top - visible, behavior: 'instant' });
  }, [month]);

  useEffect(() => clearTimers, []);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    let drag: Drag | null = null;
    /**
     * A swipe must not also count as a tap. A touch that moved leaves no click, but a mouse clicks
     * whatever it lets go of — the entry that travelled under it.
     */
    let swallowUntil = 0;

    // Anywhere on the screen, not only over the month's content: a month with little in it
    // leaves empty space below, and the finger there swipes too.
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (drag || busy.current || insideExcludedArea(event.target) || screenCovered()) return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        locked: false,
        dropped: false,
        meter: new FlickMeter(event.clientX, event.timeStamp),
      };
    }

    function onPointerMove(event: PointerEvent) {
      const state = drag;
      if (!state || state.dropped || event.pointerId !== state.id) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.locked) {
        if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return;
        // The first clear movement decides: sideways is the month's, anything else the scroll's.
        if (Math.abs(dx) < Math.abs(dy) * MIN_RATIO) {
          state.dropped = true;
          return;
        }
        state.locked = true;
        if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
        settleTimer.current = null;
        actions.current.placeGhosts(el!);
        el!.style.transition = 'none';
        el!.style.willChange = 'transform';
        // A mouse drag would otherwise select the text it passes over.
        el!.style.userSelect = 'none';
        window.getSelection()?.removeAllRanges();
      }
      state.meter.move(event.clientX, event.timeStamp);
      el!.style.transform = `translate3d(${dx}px, 0, 0)`;
    }

    function onPointerUp(event: PointerEvent) {
      const state = drag;
      if (!state || event.pointerId !== state.id) return;
      drag = null;
      if (!state.locked || state.dropped) return;
      swallowUntil = performance.now() + SWALLOW_CLICK_MS;
      const dx = event.clientX - state.x;
      const speed = Math.abs(state.meter.speed(event.clientX, event.timeStamp));
      if (swipeCommits(Math.abs(dx), el!.clientWidth, speed)) actions.current.slideTo(dx < 0 ? 1 : -1);
      else actions.current.springBack();
    }

    function onPointerCancel(event: PointerEvent) {
      const state = drag;
      if (!state || event.pointerId !== state.id) return;
      drag = null;
      if (state.locked && !state.dropped) actions.current.springBack();
    }

    function onClickCapture(event: MouseEvent) {
      if (performance.now() > swallowUntil) return;
      swallowUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    }

    /** A link dragged with the mouse would start the browser's own drag and end the swipe. */
    function onDragStart(event: DragEvent) {
      if (drag) event.preventDefault();
    }

    /** A new gesture anywhere: whatever the last one left behind is over. */
    function onAnyPointerDown() {
      swallowUntil = 0;
    }

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('dragstart', onDragStart);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('pointerdown', onAnyPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('pointerdown', onAnyPointerDown, true);
    };
  }, []);

  const go = useCallback((step: Step) => {
    if (!busy.current) actions.current.slideTo(step);
  }, []);

  return (
    // Only sideways is clipped: the months waiting at the sides never widen the page.
    <div className="overflow-x-clip">
      <div ref={wrapper} className={`relative touch-pan-y ${className}`}>
        <MonthSwipeContext.Provider value={go}>{children}</MonthSwipeContext.Provider>
        {within(shiftMonth(month, -1)) && <MonthGhost month={shiftMonth(month, -1)} side={-1} />}
        {within(shiftMonth(month, 1)) && <MonthGhost month={shiftMonth(month, 1)} side={1} />}
      </div>
    </div>
  );
}

/** The month waiting at one side: its name and "Carregando…", like its screen while it loads. */
function MonthGhost({ month, side }: { month: Month; side: Step }) {
  return (
    <div
      aria-hidden
      inert
      data-month-ghost
      className="absolute top-0 flex w-full flex-col gap-4 px-4"
      style={side === 1 ? { left: `calc(100% + ${GAP}px)` } : { right: `calc(100% + ${GAP}px)` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground flex h-11 w-11 items-center justify-center text-xl">‹</span>
        <span className="text-foreground text-lg font-semibold">{formatMonthLabel(month)}</span>
        <span className="text-foreground flex h-11 w-11 items-center justify-center text-xl">›</span>
      </div>
      <p className="text-muted py-16 text-center">Carregando…</p>
    </div>
  );
}
