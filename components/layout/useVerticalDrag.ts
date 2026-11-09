'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { FlickMeter, LOCK_DISTANCE, MIN_RATIO } from './swipePhysics';

export interface VerticalDragOptions {
  /** Which way the drag goes: up (opening something from below) or down (closing it). */
  direction: 'up' | 'down';
  /** Asked when the finger goes down; false leaves the gesture alone (a list that is scrolled). */
  canStart?: (target: EventTarget | null) => boolean;
  /** `distance` (px, ≥ 0) travelled the right way since the drag was recognised. */
  onMove: (distance: number) => void;
  /** Let go: the distance, and the speed (px/ms) the right way at the end, for a flick. */
  onEnd: (distance: number, speed: number) => void;
  disabled?: boolean;
}

/** How long after a drag the click it may leave behind is still the drag's, not a tap. */
const CLICK_AFTER_DRAG_MS = 400;

interface DragState {
  x: number;
  y: number;
  locked: boolean;
  dropped: boolean;
  meter: FlickMeter;
}

/**
 * A drag up or down on `ref` that the screen follows (the up-arrow opening the app drawer, the
 * drawer pulled down to close, the widget tray). The page scroll is never switched off with CSS:
 * on touch, a gesture that goes the right way calls `preventDefault` on its `touchmove`s (the
 * listener is not passive), which is what keeps the browser from also scrolling; anything else —
 * a scroll the other way, a sideways swipe — is left to the browser. A mouse drags too.
 *
 * `wasDragged()` tells a tap from the end of a drag, for the element's own `onClick`.
 */
export function useVerticalDrag(ref: RefObject<HTMLElement | null>, options: VerticalDragOptions) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const endedAt = useRef(-Infinity);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let state: DragState | null = null;
    const along = (dy: number) => (latest.current.direction === 'up' ? -dy : dy);

    function begin(x: number, y: number, time: number, target: EventTarget | null) {
      const opts = latest.current;
      state =
        opts.disabled || (opts.canStart && !opts.canStart(target))
          ? null
          : { x, y, locked: false, dropped: false, meter: new FlickMeter(0, time) };
    }

    /** Whether this movement belongs to the drag (and so must not scroll the page). */
    function move(x: number, y: number, time: number): boolean {
      if (!state || state.dropped) return false;
      const dx = x - state.x;
      const distance = along(y - state.y);
      if (!state.locked) {
        if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(distance) < LOCK_DISTANCE) return distance > 0;
        if (distance <= 0 || Math.abs(distance) < Math.abs(dx) * MIN_RATIO) {
          state.dropped = true;
          return false;
        }
        state.locked = true;
      }
      state.meter.move(distance, time);
      latest.current.onMove(Math.max(0, distance));
      return true;
    }

    function end(y: number, time: number) {
      const finished = state;
      state = null;
      if (!finished?.locked) return;
      endedAt.current = performance.now();
      const distance = along(y - finished.y);
      latest.current.onEnd(Math.max(0, distance), finished.meter.speed(distance, time));
    }

    function cancel() {
      const finished = state;
      state = null;
      if (finished?.locked) {
        endedAt.current = performance.now();
        latest.current.onEnd(0, 0);
      }
    }

    // Touch: its own events, so a drag the right way can stop the scroll from the first move.
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        state = null;
        return;
      }
      const touch = event.touches[0];
      begin(touch.clientX, touch.clientY, event.timeStamp, event.target);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch && move(touch.clientX, touch.clientY, event.timeStamp) && event.cancelable)
        event.preventDefault();
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (touch) end(touch.clientY, event.timeStamp);
      else cancel();
    };

    // Mouse: pointer events, followed on the window so the drag survives leaving the element.
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') move(event.clientX, event.clientY, event.timeStamp);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      end(event.clientY, event.timeStamp);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      begin(event.clientX, event.clientY, event.timeStamp, event.target);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('pointerdown', onPointerDown);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', cancel);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [ref]);

  const wasDragged = useCallback(() => performance.now() - endedAt.current < CLICK_AFTER_DRAG_MS, []);
  return { wasDragged };
}
