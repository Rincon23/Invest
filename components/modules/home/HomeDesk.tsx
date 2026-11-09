'use client';

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  BACK_MS,
  EASE,
  EDGE_RESISTANCE,
  FlickMeter,
  IN_MS,
  LOCK_DISTANCE,
  MIN_RATIO,
  insideExcludedArea,
  swipeCommits,
} from '@/components/layout/swipePhysics';
import { LONG_PRESS_MS, pageBox, pageStep, trackTransform } from './homeLayout';

/** How far a finger may wander during the long press before it counts as a scroll or a swipe. */
const PRESS_TOLERANCE = 8;
/** How long after a swipe (or the long press) a click is still the gesture's, not a tap. */
const SWALLOW_CLICK_MS = 400;

export interface HomeDeskHandle {
  /** Puts page `index` on screen at once, without the slide — for the tour, which measures next. */
  jump: (index: number) => void;
  /** The element of page `index` (its own scroll container). */
  page: (index: number) => HTMLElement | null;
  /** The visible window onto the track. */
  viewport: () => HTMLElement | null;
}

interface Drag {
  x: number;
  y: number;
  locked: boolean;
  dropped: boolean;
  step: number;
  meter: FlickMeter;
}

/** Empty space: no widget and nothing to tap under the finger, where a long press means "edit". */
function onEmptySpace(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !target.closest('[data-home-widget], a, button, input, textarea, select, label, [role="dialog"]')
  );
}

/**
 * The telas of the Início, side by side on one track — all of them in the page at
 * once, so the neighbour is already there while the finger drags. Swiping sideways pages between
 * them with the physics of a phone's home screen (`swipePhysics.ts`): the track follows the finger,
 * gives a little and springs back at the first and the last, and changes page past 30% of the
 * width or on a flick. A mouse drags too, and the arrow keys page.
 *
 * Each page scrolls down on its own and keeps its own position (`overscroll-behavior: contain`,
 * `touch-action: pan-y`: up and down stay the browser's, sideways is ours). Nothing calls
 * `preventDefault` to get there, so scrolling, taps and the widgets' own drags are untouched; a
 * swipe stops while `isBlocked()` (a widget being dragged in edit mode).
 *
 * A long press on empty space (`onLongPress`) turns edit mode on.
 */
export function HomeDesk({
  ref,
  count,
  current,
  editing,
  label,
  onChange,
  isBlocked,
  onLongPress,
  renderPage,
}: {
  ref?: Ref<HomeDeskHandle>;
  /** How many pages the track has (in edit mode, with the "new tela" one at the end). */
  count: number;
  current: number;
  editing: boolean;
  /** The accessible name of each page ("Tela 1 de 3"). */
  label: (index: number) => string;
  onChange: (index: number) => void;
  isBlocked: () => boolean;
  onLongPress?: () => void;
  renderPage: (index: number) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const pages = useRef<(HTMLElement | null)[]>([]);
  /** Where the track was last put, so a re-render that changes nothing does not slide it again. */
  const placed = useRef<{ index: number; editing: boolean } | null>(null);
  const settleTimer = useRef<number | null>(null);

  // The window listeners (attached once) read the latest props through this.
  const latest = useRef({ count, current, editing, onChange, isBlocked, onLongPress });
  useEffect(() => {
    latest.current = { count, current, editing, onChange, isBlocked, onLongPress };
  });

  /** Slides the track to page `index` (and leaves no transition behind once it is there). */
  function slide(index: number, isEditing: boolean, ms: number) {
    const el = track.current;
    if (!el) return;
    el.style.transition = `transform ${ms}ms ${EASE}`;
    el.style.transform = trackTransform(index, isEditing);
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      el.style.transition = '';
      el.style.willChange = '';
    }, ms);
  }
  const slideRef = useRef(slide);
  useEffect(() => {
    slideRef.current = slide;
  });

  useImperativeHandle(ref, () => ({
    jump: (index) => {
      const el = track.current;
      if (!el) return;
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      el.style.transition = 'none';
      el.style.transform = trackTransform(index, latest.current.editing);
      placed.current = { index, editing: latest.current.editing };
    },
    page: (index) => pages.current[index] ?? null,
    viewport: () => viewport.current,
  }));

  // Whatever moved the page (a dot, a swipe, edit mode shrinking the pages), the track follows —
  // at once the first time, with the slide after that.
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const before = placed.current;
    placed.current = { index: current, editing };
    if (!before) {
      el.style.transition = 'none';
      el.style.transform = trackTransform(current, editing);
      return;
    }
    if (before.index !== current || before.editing !== editing) slideRef.current(current, editing, IN_MS);
  }, [current, editing]);

  useEffect(() => {
    const el = viewport.current;
    const strip = track.current;
    if (!el || !strip) return;
    let drag: Drag | null = null;
    let press: { x: number; y: number; timer: number } | null = null;
    /**
     * A drag that moved the page (or a long press) must not also count as a tap. Only the click
     * right after it: a touch that moved leaves no click at all, and the next tap — anywhere,
     * a dot or the ✓ outside this element included — must go through.
     */
    let swallowUntil = 0;
    /** The long press fired: the click when the finger finally lifts is its too. */
    let pressFired = false;
    const swallowNextClick = () => {
      swallowUntil = performance.now() + SWALLOW_CLICK_MS;
    };

    const cancelPress = () => {
      if (press) window.clearTimeout(press.timer);
      press = null;
    };
    const springBack = () => {
      const { current: index, editing: isEditing } = latest.current;
      slideRef.current(index, isEditing, BACK_MS);
    };

    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pressFired = false;
      cancelPress();
      if (insideExcludedArea(event.target)) {
        drag = null;
        return;
      }
      const { editing: isEditing, onLongPress: longPress } = latest.current;
      drag = {
        x: event.clientX,
        y: event.clientY,
        locked: false,
        dropped: false,
        step: pageStep(el!.clientWidth, isEditing),
        meter: new FlickMeter(event.clientX, event.timeStamp),
      };
      if (!isEditing && longPress && onEmptySpace(event.target)) {
        press = {
          x: event.clientX,
          y: event.clientY,
          timer: window.setTimeout(() => {
            press = null;
            drag = null;
            pressFired = true;
            // The browser only lets a page vibrate once it has been tapped (the first long press
            // of a visit, finger still down, does not count yet).
            if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(15);
            latest.current.onLongPress?.();
          }, LONG_PRESS_MS),
        };
      }
    }

    function onPointerMove(event: PointerEvent) {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_TOLERANCE)
        cancelPress();
      const state = drag;
      if (!state || state.dropped) return;
      if (latest.current.isBlocked()) {
        // A widget came loose in edit mode: the drag is its, not the page's.
        state.dropped = true;
        if (state.locked) springBack();
        return;
      }

      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.locked) {
        if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return;
        // The first clear movement decides: sideways is ours, anything else is the page's scroll.
        if (Math.abs(dx) < Math.abs(dy) * MIN_RATIO) {
          state.dropped = true;
          return;
        }
        state.locked = true;
        cancelPress();
        if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
        strip!.style.transition = 'none';
        strip!.style.willChange = 'transform';
      }
      state.meter.move(event.clientX, event.timeStamp);

      // No page on that side: the track still gives a little, then holds — the rubber band of a
      // phone home screen saying "this is the last one".
      const { current: index, count: total, editing: isEditing } = latest.current;
      const target = index + (dx < 0 ? 1 : -1);
      const free = target >= 0 && target < total;
      strip!.style.transform = trackTransform(index, isEditing, free ? dx : dx * EDGE_RESISTANCE);
    }

    function onPointerUp(event: PointerEvent) {
      cancelPress();
      if (pressFired) {
        pressFired = false;
        swallowNextClick();
      }
      const state = drag;
      drag = null;
      if (!state?.locked || state.dropped) return;
      swallowNextClick();

      const { current: index, count: total, editing: isEditing, onChange: change } = latest.current;
      const dx = event.clientX - state.x;
      const target = index + (dx < 0 ? 1 : -1);
      const speed = Math.abs(state.meter.speed(event.clientX, event.timeStamp));
      if (target < 0 || target >= total || !swipeCommits(Math.abs(dx), state.step, speed)) {
        springBack();
        return;
      }
      slideRef.current(target, isEditing, IN_MS);
      placed.current = { index: target, editing: isEditing };
      change(target);
    }

    function onPointerCancel() {
      cancelPress();
      const state = drag;
      drag = null;
      if (state?.locked && !state.dropped) springBack();
    }

    function onClickCapture(event: MouseEvent) {
      if (performance.now() > swallowUntil) return;
      swallowUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    }

    /** A new gesture anywhere: whatever the last one left behind is over. */
    function onAnyPointerDown() {
      swallowUntil = 0;
    }

    function onContextMenu(event: MouseEvent) {
      // The long press that turned edit mode on is not also a request for the browser's menu.
      if (pressFired) event.preventDefault();
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('pointerdown', onAnyPointerDown, true);
    return () => {
      cancelPress();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('pointerdown', onAnyPointerDown, true);
    };
  }, []);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.altKey || event.ctrlKey || event.metaKey || insideExcludedArea(event.target) || isBlocked())
      return;
    const next = current + (event.key === 'ArrowRight' ? 1 : -1);
    if (next < 0 || next >= count) return;
    event.preventDefault();
    onChange(next);
    // The page left behind becomes inert: the focus moves on with the person.
    requestAnimationFrame(() => pages.current[next]?.focus({ preventScroll: true }));
  }

  return (
    <div
      ref={viewport}
      role="region"
      aria-label="Telas"
      onKeyDown={handleKeyDown}
      // A link dragged with the mouse would start the browser's own drag and cancel the swipe.
      onDragStart={(event) => event.preventDefault()}
      // Nothing may scroll the viewport itself sideways (a focus could): the track does the moving.
      onScroll={(event) => {
        if (event.currentTarget.scrollLeft !== 0) event.currentTarget.scrollLeft = 0;
      }}
      className="relative min-h-0 flex-1 overflow-hidden select-none"
    >
      <div ref={track} className="absolute inset-0">
        {Array.from({ length: count }, (_, index) => (
          <section
            key={index}
            ref={(node) => {
              pages.current[index] = node;
            }}
            aria-label={label(index)}
            aria-hidden={index !== current}
            inert={index !== current}
            tabIndex={-1}
            style={pageBox(index, editing)}
            className={`absolute touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain transition-[left,width,top,bottom] duration-200 outline-none ${
              editing ? 'border-border bg-card/40 rounded-3xl border' : ''
            }`}
          >
            {renderPage(index)}
          </section>
        ))}
      </div>
    </div>
  );
}
