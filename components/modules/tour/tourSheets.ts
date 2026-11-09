import type { TourSheet } from '@/lib/modules';

export type TourSheetRequest = TourSheet | 'close';

type Listener = (request: TourSheetRequest) => void;

const listeners = new Set<Listener>();
/** A request made before any screen could handle it (the month screen was still loading). */
let pending: TourSheetRequest | null = null;

/**
 * Asks the month screen to open (or close) a sheet for a tour step: the expense form. The tour
 * runs above every route, while those sheets belong to `MonthShell`, which may
 * only mount after the tour navigated to it — so an unhandled request waits for it.
 */
export function requestTourSheet(request: TourSheetRequest): void {
  if (listeners.size === 0) {
    pending = request === 'close' ? null : request;
    return;
  }
  pending = null;
  for (const listener of listeners) listener(request);
}

export function subscribeTourSheets(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    const request = pending;
    pending = null;
    listener(request);
  }
  return () => {
    listeners.delete(listener);
  };
}
