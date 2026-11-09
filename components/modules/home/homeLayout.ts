import type { CSSProperties } from 'react';

/**
 * The geometry of the Início: the áreas de trabalho side by side on one track, each a page of the
 * viewport's width — or, in edit mode, a little narrower and inset, so the edges of the neighbours
 * show on both sides, like a phone's home screen being edited. Everything is in % of the viewport
 * (the track covers it exactly), so nothing has to be measured to lay it out.
 */

/** The strip under the áreas: the up-arrow ("Apps"). */
export const HOME_FOOTER_HEIGHT = '3rem';

/**
 * The lane right above that strip where the squares of the telas float, over the áreas (no strip
 * of their own). The floating buttons sit above both.
 */
export const HOME_DOTS_LANE = '1rem';

/** In edit mode: how much of the viewport a page takes, and the gap between two pages (px). */
const EDIT_WIDTH = 0.86;
const EDIT_GAP = 12;

/** How long a finger has to stay on an empty part of an área before edit mode comes on. */
export const LONG_PRESS_MS = 500;

/** How far one page is from the next, in px, for a viewport `width` px wide. */
export function pageStep(width: number, editing: boolean): number {
  return editing ? width * EDIT_WIDTH + EDIT_GAP : width;
}

/** Where the track sits to show page `index`, plus `dx` px of a drag in progress. */
export function trackTransform(index: number, editing: boolean, dx = 0): string {
  if (!editing) return `translate3d(calc(${-index * 100}% + ${dx}px), 0, 0)`;
  const inset = ((1 - EDIT_WIDTH) / 2) * 100;
  return `translate3d(calc(${inset}% - ${index} * (${EDIT_WIDTH * 100}% + ${EDIT_GAP}px) + ${dx}px), 0, 0)`;
}

/** Where page `index` sits on the track. */
export function pageBox(index: number, editing: boolean): CSSProperties {
  return editing
    ? {
        left: `calc(${index} * (${EDIT_WIDTH * 100}% + ${EDIT_GAP}px))`,
        width: `${EDIT_WIDTH * 100}%`,
        top: 8,
        bottom: 8,
      }
    : { left: `${index * 100}%`, width: '100%', top: 0, bottom: 0 };
}
