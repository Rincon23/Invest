type Listener = (anchor: string) => void;

const listeners = new Set<Listener>();
/** A request made before the Início was on screen (the tour was still navigating to it). */
let pending: string | null = null;

/**
 * Asks the Início to bring a tour step's element into view before the spotlight lands on it: the
 * Início has several áreas de trabalho side by side, and a widget may be on one that is not on
 * screen (or further down a long one). The Início switches to the área that has
 * `[data-tour=anchor]` and scrolls to it, synchronously, so the spotlight measures it in place.
 * `null` drops a request nobody took (the tour ended first).
 */
export function revealOnHome(anchor: string | null): void {
  if (anchor === null || listeners.size === 0) {
    pending = anchor;
    return;
  }
  pending = null;
  for (const listener of listeners) listener(anchor);
}

export function subscribeHomeReveal(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    const anchor = pending;
    pending = null;
    listener(anchor);
  }
  return () => {
    listeners.delete(listener);
  };
}
