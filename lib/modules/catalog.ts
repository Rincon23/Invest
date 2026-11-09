import type { ModuleKey } from '../core/types';

/** How the app drawer groups modules. */
export type ModuleGroup = 'investing' | 'banks';

export const MODULE_GROUPS: { key: ModuleGroup; label: string }[] = [
  { key: 'investing', label: 'Investimentos' },
  { key: 'banks', label: 'Bancos' },
];

/** A module's own screen, opened from the app drawer (and from its widget on the Início). */
export interface ModuleScreen {
  /** Short label, for where there is only room for a word. Everywhere with room for the whole
   *  thing (the app drawer, the home cards, the module list) uses `name`. */
  label: string;
  href: () => string;
  isActive: (pathname: string) => boolean;
}

/**
 * Everything the app needs to know about a module, written once: the module list, the app
 * drawer and the Início all read it. Icons and card components live in
 * `components/modules` (this file stays free of React).
 */
export interface ModuleDefinition {
  key: ModuleKey;
  name: string;
  /** A few words for a menu line (the app drawer, the widget tray). */
  tagline: string;
  group: ModuleGroup;
  /** Modules this one is built on: one of them restricted for an account hides this one too. */
  dependsOn: ModuleKey[];
  /** Absent for a module that only adds to other screens. */
  screen?: ModuleScreen;
  /** Whether the home dashboard shows a card for it. */
  homeCard: boolean;
  /**
   * Starts restricted (only accounts with access have it). The owner changes it in Administração
   * ("Restrito", saved in `module_access`); everything reads that choice (`vipModules`), never this
   * field directly.
   */
  vipByDefault?: boolean;
}

/**
 * Every module, in catalog order. A module always comes after the ones it depends on, which is
 * also the order of the defaults (the app drawer and the Início widgets).
 */
export const MODULES: ModuleDefinition[] = [
  {
    key: 'diagram',
    name: 'Diagrama',
    tagline: 'Quanto aportar em cada ativo',
    group: 'investing',
    dependsOn: [],
    screen: {
      label: 'Diagrama',
      href: () => '/diagrama',
      isActive: (pathname) => pathname.startsWith('/diagrama'),
    },
    homeCard: true,
  },
  {
    key: 'history',
    name: 'Histórico',
    tagline: 'Como a sua carteira andou',
    group: 'investing',
    dependsOn: ['diagram'],
    screen: {
      label: 'Histórico',
      href: () => '/historico',
      isActive: (pathname) => pathname.startsWith('/historico'),
    },
    homeCard: true,
  },
  {
    key: 'banks',
    name: 'Open Finance',
    tagline: 'Suas corretoras no Invest +, uma vez por dia',
    group: 'banks',
    dependsOn: ['diagram'],
    screen: {
      label: 'Bancos',
      href: () => '/bancos',
      isActive: (pathname) => pathname.startsWith('/bancos'),
    },
    homeCard: true,
    // Each person brings their own free Meu Pluggy key; the owner tries it first.
    vipByDefault: true,
  },
];

export const MODULE_KEYS: ModuleKey[] = MODULES.map((definition) => definition.key);

const BY_KEY = new Map(MODULES.map((definition) => [definition.key, definition]));

export function moduleDefinition(key: ModuleKey): ModuleDefinition {
  const found = BY_KEY.get(key);
  if (!found) throw new Error(`Módulo desconhecido: ${key}`);
  return found;
}

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && BY_KEY.has(value as ModuleKey);
}

/** "Diagrama", "Diagrama e Histórico", "A, B e C". */
export function moduleNames(keys: ModuleKey[]): string {
  const names = keys.map((key) => moduleDefinition(key).name);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}
