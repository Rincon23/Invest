import type { BudgetSettings, HomeWidgetKey, NavKey } from '../budget/types';

/**
 * The card modules merged into one. "Cartão de crédito" (the card question), "Cartões" (the
 * registered cards and their bills) and "Parcelados" were three modules with three screens for
 * what is, to the person using it, a single thing: the card. They are now the module `card`,
 * with the screen `/cartao`.
 *
 * Nobody loses anything in the move: whoever had any of the old ones on ends up with Cartão on,
 * and wherever the old keys were saved — the bottom bar, the order of the Início cards — they
 * become `card`, in the same place, without ever appearing twice.
 */

/** The keys that no longer exist, and what they became. */
export const MERGED_CARD_MODULES = ['cards', 'installments'] as const;

export type MergedCardModule = (typeof MERGED_CARD_MODULES)[number];

function isMerged(key: string): key is MergedCardModule {
  return (MERGED_CARD_MODULES as readonly string[]).includes(key);
}

/** Replaces the old keys with `card`, keeping the first position and dropping the repeats. */
function mergeList<T extends string>(list: T[]): T[] {
  const merged: T[] = [];
  for (const key of list) {
    const next = (isMerged(key) ? 'card' : key) as T;
    if (!merged.includes(next)) merged.push(next);
  }
  return merged;
}

export interface CardModuleMigration {
  modules: Partial<Record<string, boolean>>;
  nav: NavKey[] | null;
  homeOrder: HomeWidgetKey[] | null;
  /** False when this account had nothing from before: no write is needed. */
  changed: boolean;
}

/**
 * What one account's settings become. Idempotent: an account already migrated (or one that
 * never used the old modules) comes back with `changed: false` and nothing touched.
 */
export function migrateCardModule(
  settings: Pick<BudgetSettings, 'modules' | 'nav' | 'homeOrder'>,
): CardModuleMigration {
  const stored: Record<string, boolean | undefined> = { ...(settings.modules ?? {}) };
  const hadOld = MERGED_CARD_MODULES.some((key) => key in stored);
  const modules: Partial<Record<string, boolean>> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!isMerged(key)) modules[key] = value;
  }
  // Whoever had Cartões or Parcelados on gets Cartão on — they were already using it.
  if (MERGED_CARD_MODULES.some((key) => stored[key] === true)) modules.card = true;

  const nav = settings.nav ? mergeList(settings.nav) : null;
  const homeOrder = settings.homeOrder ? mergeList(settings.homeOrder) : null;
  const changed =
    hadOld ||
    JSON.stringify(nav) !== JSON.stringify(settings.nav ?? null) ||
    JSON.stringify(homeOrder) !== JSON.stringify(settings.homeOrder ?? null);

  return { modules, nav, homeOrder, changed };
}

/**
 * The two reserves merged into one. "Reserva investida" (`investments`) and "Reserva de
 * emergência" (`cash`) were two modules side by side, with nearly the same name, for what the
 * person sees as one thing: their reserve. They are now the module `cash`, "Reserva", whose
 * screen has the tabs Emergência and Investida.
 *
 * Nobody loses anything in the move: whoever had the invested reserve on ends up with Reserva on,
 * and wherever its widget was on the Início, the Reserva widget takes that place — never twice.
 */
export const MERGED_RESERVE_MODULE = 'investments';

/** What an old key becomes wherever a module or a widget is saved. */
export function renameReserveKey<T extends string>(key: T): T {
  return (key === MERGED_RESERVE_MODULE ? 'cash' : key) as T;
}

/**
 * Modules taken out of the app, with nothing in their place (2026-10-28, "não bate com a proposta
 * do app"): the Monitor de Gmail and "Lançar por voz ou texto". Wherever an older account saved
 * one — a tela of the Início, the hidden widgets, the old bottom bar — it is simply left out.
 */
export const RETIRED_MODULES: readonly string[] = ['gmail', 'voice'];

/** `list` without the retired modules; anything that is not a list comes back as it was. */
export function withoutRetiredModules(list: unknown): unknown {
  return Array.isArray(list) ? list.filter((key) => !RETIRED_MODULES.includes(key)) : list;
}

type ReserveSettings = Pick<
  BudgetSettings,
  'modules' | 'nav' | 'homeOrder' | 'homePages' | 'homeHidden' | 'homeCardSizes'
>;

export interface ReserveModuleMigration {
  modules: Partial<Record<string, boolean>>;
  nav: NavKey[] | null;
  homeOrder: HomeWidgetKey[] | null;
  homePages: HomeWidgetKey[][] | null;
  homeHidden: HomeWidgetKey[];
  homeCardSizes: Partial<Record<HomeWidgetKey, 'half' | 'full'>>;
  /** False when this account had nothing from before: no write is needed. */
  changed: boolean;
}

/** Replaces the old key with `cash`, keeping the first position and dropping the repeats. */
function renameList<T extends string>(list: T[], seen: Set<string> = new Set()): T[] {
  const renamed: T[] = [];
  for (const key of list) {
    const next = renameReserveKey(key);
    if (next === 'cash') {
      if (seen.has('cash')) continue;
      seen.add('cash');
    } else if (renamed.includes(next)) continue;
    renamed.push(next);
  }
  return renamed;
}

/**
 * What one account's settings become. Idempotent: an account already migrated (or one that
 * never had the invested reserve) comes back with `changed: false` and nothing touched.
 */
export function migrateReserveModule(settings: ReserveSettings): ReserveModuleMigration {
  const old = MERGED_RESERVE_MODULE as string;
  const stored: Record<string, boolean | undefined> = { ...(settings.modules ?? {}) };
  const hidden = (settings.homeHidden ?? []) as string[];
  const sizes: Record<string, 'half' | 'full' | undefined> = { ...(settings.homeCardSizes ?? {}) };
  const pages = (settings.homePages ?? null) as string[][] | null;
  const lists = [settings.nav ?? [], settings.homeOrder ?? [], ...(pages ?? [])] as string[][];
  const changed =
    old in stored || hidden.includes(old) || old in sizes || lists.some((list) => list.includes(old));

  const modules: Partial<Record<string, boolean>> = {};
  for (const [key, value] of Object.entries(stored)) if (key !== old) modules[key] = value;
  // Whoever used the invested reserve gets the Reserva on: it is where the quotas live now.
  if (stored[old] === true) modules.cash = true;

  // The invested widget was showing, so the Reserva widget shows (in its place, if it was hidden).
  const investedShown = stored[old] === true && !hidden.includes(old);
  const homeHidden = hidden.filter((key) => key !== old && !(key === 'cash' && investedShown));
  delete sizes[old];

  const seenInPages = new Set<string>();
  return {
    modules,
    nav: settings.nav ? renameList(settings.nav) : null,
    homeOrder: settings.homeOrder ? renameList(settings.homeOrder) : null,
    homePages: pages ? (pages.map((page) => renameList(page, seenInPages)) as HomeWidgetKey[][]) : null,
    homeHidden: homeHidden as HomeWidgetKey[],
    homeCardSizes: sizes as Partial<Record<HomeWidgetKey, 'half' | 'full'>>,
    changed,
  };
}
