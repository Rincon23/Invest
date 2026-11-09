/**
 * The phone's back button closes the sheet on top instead of leaving the screen under it.
 *
 * Every open sheet pushes a history entry of its own (same URL, with Next's state copied, so the
 * router treats it as the page it already shows). Pressing back pops that entry and the sheet on
 * top decides what happens: it closes, or — with unsaved changes — asks first and pushes a new
 * entry to stay. A sheet the app closes by itself (saved, or closed by a button) leaves its entry
 * behind on purpose: taking it out with `history.back()` could race a navigation the same tap
 * started (a link in the sheet, the tour moving on) and undo it. The next back press that lands
 * on one of those leftover entries simply goes on, so it never costs the person an extra press.
 */

const STATE_KEY = '__capitalSheet';

export interface SheetEntry {
  entry: string;
  /** The back button was pressed while this sheet was on top. */
  onBack: () => void;
}

const open: SheetEntry[] = [];
/** The sheet entry the history is on right now (null on an ordinary page entry). */
let current: string | null = null;
/** Pops this module caused itself, which must not count as a back press. */
let ownPops = 0;
let listening = false;

function entryOf(state: unknown): string | null {
  if (!state || typeof state !== 'object' || !(STATE_KEY in state)) return null;
  return String((state as Record<string, unknown>)[STATE_KEY]);
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function onPopState(event: PopStateEvent) {
  const left = current;
  current = entryOf(event.state);
  if (ownPops > 0) {
    ownPops -= 1;
    return;
  }
  if (!left) return;
  const sheet = open.find((item) => item.entry === left);
  if (sheet) sheet.onBack();
  // The entry of a sheet that is already gone: nothing to close, the press goes on.
  else window.history.back();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  current = entryOf(window.history.state);
  window.addEventListener('popstate', onPopState);
}

/** Pushes a new entry for a sheet and returns its id. */
export function pushSheetEntry(): string {
  listen();
  const entry = newId();
  const state = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
  window.history.pushState({ ...state, [STATE_KEY]: entry }, '', window.location.href);
  current = entry;
  return entry;
}

export function registerSheet(sheet: SheetEntry): () => void {
  open.push(sheet);
  return () => {
    const index = open.indexOf(sheet);
    if (index !== -1) open.splice(index, 1);
  };
}

/**
 * Takes the sheet's entry out when the sheet itself is closing it (the X, the dark backdrop,
 * "Sair sem salvar"): nothing else is happening at that moment, so going back is safe.
 */
export function popSheetEntry(entry: string) {
  if (current !== entry) return;
  ownPops += 1;
  window.history.back();
}
