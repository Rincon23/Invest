import type { ModuleKey, Month } from '../budget/types';

/** How the app drawer groups modules. */
export type ModuleGroup = 'progress' | 'month' | 'wallet' | 'investing' | 'assistant';

export const MODULE_GROUPS: { key: ModuleGroup; label: string }[] = [
  { key: 'progress', label: 'Seu progresso' },
  { key: 'month', label: 'Dinheiro do mês' },
  { key: 'wallet', label: 'Carteira' },
  { key: 'investing', label: 'Investimentos' },
  { key: 'assistant', label: 'Assistente' },
];

/** A module's own screen, opened from the app drawer (and from its widget on the Início). */
export interface ModuleScreen {
  /** Short label, for where there is only room for a word. Everywhere with room for the whole
   *  thing (the app drawer, the home cards, the module list) uses `name`. */
  label: string;
  href: (month: Month) => string;
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
  /** Absent for modules that only add to other screens (the card question, the microphone). */
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
    key: 'missions',
    name: 'Missões',
    tagline: 'Tarefas que dão XP e sobem o seu nível',
    group: 'progress',
    dependsOn: [],
    screen: {
      label: 'Missões',
      href: () => '/missoes',
      isActive: (pathname) => pathname.startsWith('/missoes'),
    },
    // Not a widget: a bar fixed on top of the Início (MissionsBar), which nobody takes off.
    homeCard: false,
  },
  {
    key: 'expenses',
    name: 'Lançamentos',
    tagline: 'Gastos e rendas do mês',
    group: 'month',
    dependsOn: [],
    screen: {
      label: 'Lançamentos',
      href: (month) => `/mes/${month}/lancamentos`,
      isActive: (pathname) => /^\/mes\/[^/]+\/lancamentos(\/|$)/.test(pathname),
    },
    homeCard: true,
  },
  {
    key: 'budget',
    name: 'Gastos por categoria',
    tagline: 'Metas e quanto ainda dá para gastar',
    group: 'month',
    dependsOn: ['expenses'],
    screen: {
      label: 'Categorias',
      href: (month) => `/mes/${month}/categorias`,
      // The category detail (/categoria/[id]) belongs to the same screen.
      isActive: (pathname) => /^\/mes\/[^/]+\/categorias?(\/|$)/.test(pathname),
    },
    homeCard: true,
  },
  {
    key: 'card',
    name: 'Cartão',
    tagline: 'Compras, parcelamento e a fatura de cada mês',
    group: 'month',
    dependsOn: ['expenses'],
    screen: {
      label: 'Cartão',
      href: () => '/cartao',
      isActive: (pathname) => pathname.startsWith('/cartao'),
    },
    homeCard: true,
  },
  {
    key: 'reimbursable',
    name: 'A receber',
    tagline: 'O que alguém vai te devolver',
    group: 'month',
    // Not only card purchases: lending R$ 50 in cash is the same thing, so it only needs Lançamentos.
    dependsOn: ['expenses'],
    homeCard: true,
  },
  {
    key: 'history',
    name: 'Histórico e gráficos',
    tagline: 'Sua evolução mês a mês',
    group: 'month',
    dependsOn: ['budget'],
    screen: {
      label: 'Histórico',
      href: () => '/historico',
      isActive: (pathname) => pathname.startsWith('/historico'),
    },
    homeCard: true,
  },
  {
    key: 'recurring',
    name: 'Contas do mês',
    tagline: 'O que falta pagar este mês',
    group: 'wallet',
    dependsOn: ['expenses'],
    screen: {
      label: 'Contas',
      href: () => '/carteira/recorrentes',
      isActive: (pathname) => pathname.startsWith('/carteira/recorrentes'),
    },
    homeCard: true,
  },
  {
    key: 'cash',
    // One module for what used to be two ("Reserva de emergência" and "Reserva investida"): to the
    // person it is a single thing, their reserve, with two tabs.
    name: 'Reserva',
    tagline: 'Quanto você tem e quanto falta',
    group: 'wallet',
    dependsOn: [],
    screen: {
      label: 'Reserva',
      href: () => '/carteira/caixa',
      isActive: (pathname) => pathname.startsWith('/carteira/caixa'),
    },
    homeCard: true,
  },
  {
    key: 'banks',
    name: 'Open Finance',
    tagline: 'Seus bancos no Capital +, uma vez por dia',
    group: 'wallet',
    dependsOn: [],
    screen: {
      label: 'Bancos',
      href: () => '/bancos',
      isActive: (pathname) => pathname.startsWith('/bancos'),
    },
    homeCard: true,
    // Each person brings their own free Meu Pluggy key; the owner tries it first.
    vipByDefault: true,
  },
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
    key: 'reminders',
    name: 'Lembretes',
    tagline: 'Tarefas e compromissos com aviso',
    group: 'assistant',
    dependsOn: [],
    screen: {
      label: 'Lembretes',
      href: () => '/lembretes',
      isActive: (pathname) => pathname.startsWith('/lembretes'),
    },
    homeCard: true,
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

/** "Lançamentos", "Lançamentos e Cartão de crédito", "A, B e C". */
export function moduleNames(keys: ModuleKey[]): string {
  const names = keys.map((key) => moduleDefinition(key).name);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}
