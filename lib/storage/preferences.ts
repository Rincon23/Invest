/** Lightweight per-device preferences. Not part of the budget data model, so localStorage is fine here. */

const THEME_KEY = 'capital:theme';
const LAST_MONTH_KEY = 'capital:lastMonth';
const UNFORESEEN_ESTIMATE_KEY = 'capital:unforeseenEstimate';
const MORE_LAYOUT_KEY = 'capital:moreLayout';
const HOME_PAGE_KEY = 'capital:homePage';

export type Theme = 'light' | 'dark' | 'system';

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const value = window.localStorage.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function setStoredTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_KEY, theme);
}

export function getLastViewedMonth(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(LAST_MONTH_KEY);
}

export function setLastViewedMonth(month: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_MONTH_KEY, month);
}

/**
 * The user's own estimate (from the onboarding wizard) of how much they spend per
 * month on unavoidable surprises. Reference only — shown as a hint, never turned
 * into a real expense automatically.
 */
export function getUnforeseenEstimate(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(UNFORESEEN_ESTIMATE_KEY);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function setUnforeseenEstimate(amount: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(UNFORESEEN_ESTIMATE_KEY, String(amount));
}

/** How the app drawer shows its entries: a settings-style list, or a grid of icons (the default). */
export type MoreLayout = 'list' | 'grid';

export function getStoredMoreLayout(): MoreLayout {
  if (typeof window === 'undefined') return 'grid';
  try {
    return window.localStorage.getItem(MORE_LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function setStoredMoreLayout(layout: MoreLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MORE_LAYOUT_KEY, layout);
  } catch {
    // A blocked storage only means the choice is not remembered.
  }
}

/**
 * The área de trabalho the Início was on, for this session only (sessionStorage): coming back from
 * a module lands on the same one, while opening the app again starts on the first.
 */
export function getSessionHomePage(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(window.sessionStorage.getItem(HOME_PAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function setSessionHomePage(page: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(HOME_PAGE_KEY, String(page));
  } catch {
    // Nothing to do: the Início just opens on the first page next time.
  }
}
