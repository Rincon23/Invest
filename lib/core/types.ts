/**
 * Domain types shared by the whole Invest + app. They have no dependency on React or on any
 * storage technology, so the same definitions serve the pure logic, the storage layer and the UI.
 */
import type { NotificationCategory } from '../notifications/types';

/** A month, formatted "YYYY-MM" (e.g. "2026-09"). */
export type Month = string;

/** A calendar day, "YYYY-MM-DD". */
export type ISODate = string;

/** A time of day, "HH:MM". */
export type TimeOfDay = string;

/**
 * Every feature of the app is a module, organized the same way: a catalog entry, a screen, a
 * widget on the Início and its own tour (`lib/modules`). Every module is on for everyone; only a
 * restricted one is missing for an account without access.
 */
export interface ModuleFlags {
  /** Diagrama: how much of each aporte goes to each type and asset. */
  diagram: boolean;
  /** Histórico: how the portfolio of today went up and down. */
  history: boolean;
  /** Open Finance: the person's brokers, read once a day through their own Meu Pluggy, to check the Diagrama. */
  banks: boolean;
}

export type ModuleKey = keyof ModuleFlags;

/** A screen of the app: the Início or a module that has a screen. */
export type NavKey = 'inicio' | ModuleKey;

/** A widget of the Início: the card of a module, keyed by the module itself. */
export type HomeWidgetKey = ModuleKey;

/** Each account's own settings (one row per account). */
export interface AppSettings {
  /**
   * True once this account has seen the welcome. Absent/undefined is treated as true — only a
   * brand-new account's first-ever settings row is created with this explicitly false.
   */
  onboardingCompleted?: boolean;
  /** Which modules this account has. Absent/partial means "off"; resolve with `resolveModules`. */
  modules?: Partial<ModuleFlags>;
  /** One-time notices ("Novidade" cards and the like) this account already dismissed, by key. */
  dismissedNotices?: string[];
  /** Which notification categories push to this account's devices; see `isNotificationCategoryOn`. */
  notificationPrefs?: Partial<Record<NotificationCategory, boolean>>;
  /**
   * The áreas de trabalho of the Início, in order, each with its widgets in order. Absent or null
   * means the default, one page (see `resolveHomePages`).
   */
  homePages?: HomeWidgetKey[][] | null;
  /** Which of the resizable Início cards (the half-width tiles) the user stretched to full width. */
  homeCardSizes?: Partial<Record<HomeWidgetKey, 'half' | 'full'>>;
  /** The widgets the user took off the Início (edit mode); they wait in the widget tray to come back. */
  homeHidden?: HomeWidgetKey[];
}

/** Where a price came from: B3's own quotation service or, when it fails, Yahoo Finance. */
export type PriceSource = 'b3' | 'yahoo';

/** Last known price of a ticker, shared by every account. */
export interface PriceQuote {
  ticker: string;
  price: number;
  /** ISO timestamp of when the price was fetched. */
  fetchedAt: string;
  /** The asset's name as the source gave it. */
  name?: string;
  source?: PriceSource;
}
