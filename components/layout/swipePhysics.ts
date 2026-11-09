/**
 * How a sideways swipe feels in Capital, the way a phone's home screen pages: the screen follows
 * the finger, gives a little and springs back where there is nothing on that side, and changes
 * page past 30% of its width or on a quick flick. Shared by everything that pages sideways (the
 * áreas de trabalho of the Início) and, for the vertical drags (the app drawer, the widget tray),
 * the same flick and timing.
 */

/** How far (px) the finger travels before the drag is read as a swipe in some direction. */
export const LOCK_DISTANCE = 10;
/** How much more along the swipe than across it it must be at that point — a scroll is the other way. */
export const MIN_RATIO = 1.2;
/** Fraction of the page that changes it on release… */
export const COMMIT_FRACTION = 0.3;
/** …or this speed (px/ms), so a short flick works too — as long as it went at least… */
export const COMMIT_VELOCITY = 0.45;
export const MIN_FLICK_DISTANCE = 45;
/** Window (ms) the speed of the flick is measured over. */
export const VELOCITY_WINDOW = 90;
/** How much of the drag the page still follows when there is no page on that side. */
export const EDGE_RESISTANCE = 0.28;
/** The page arriving, and the page falling back into place. */
export const IN_MS = 240;
export const BACK_MS = 260;
export const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/** Whether a drag of `distance` px (out of `size`) at `speed` px/ms is enough to go through. */
export function swipeCommits(distance: number, size: number, speed: number): boolean {
  return distance > size * COMMIT_FRACTION || (speed > COMMIT_VELOCITY && distance > MIN_FLICK_DISTANCE);
}

/**
 * Whether `target` sits inside something that should keep its own horizontal gesture: a
 * scrollable strip (the tabs inside a widget, a table), an open dialog or sheet, a text field
 * (selecting text is also a horizontal drag), or anything explicitly opted out with
 * `data-no-swipe-nav` (the widget tray).
 */
export function insideExcludedArea(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el) {
    if (el.matches('input, textarea, [contenteditable="true"], [role="dialog"], [data-no-swipe-nav]'))
      return true;
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    el = el.parentElement;
  }
  return false;
}

/** Measures the speed of a drag over the last `VELOCITY_WINDOW` ms. */
export class FlickMeter {
  private mark: number;
  private markTime: number;

  constructor(position: number, time: number) {
    this.mark = position;
    this.markTime = time;
  }

  move(position: number, time: number) {
    if (time - this.markTime > VELOCITY_WINDOW) {
      this.mark = position;
      this.markTime = time;
    }
  }

  /** px/ms since the mark, in the direction of travel (positive when it grew). */
  speed(position: number, time: number): number {
    return (position - this.mark) / Math.max(time - this.markTime, 1);
  }
}
