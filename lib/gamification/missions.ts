import type { ModuleFlags, ModuleKey } from '../budget/types';
import { MODULES } from '../modules/catalog';
import { isModuleHidden } from '../modules/flags';
import type { InvestingFact } from '../motivation';

/**
 * The missions of the Missões module. The owner's rule: **XP can never come from a lie**. So a
 * mission rewards *using* the app — coming back to it, writing things down, checking things — and never
 * a *result* (how much was invested, a goal met), which depends on the numbers the person types
 * and on the month they had. Every mission gives a fixed XP, whatever the amount involved, and
 * counts once per period (a day, a week, a month or once ever), by the server's own date: logging
 * fifty expenses gives what one gives, and deleting one never takes the XP back nor gives it again.
 *
 * This catalog is meant to change as the owner sees how it plays ("vamos vendo como fica"): the
 * missions, their XP and their order all live here.
 */

/** How often a mission can be done: every day, every week (Monday to Sunday), every month, or once. */
export type MissionPeriod = 'day' | 'week' | 'month' | 'once';

export type MissionKey =
  | 'open-app'
  | 'check-banks'
  | 'month-income'
  | 'month-expense'
  | 'check-calendar'
  | 'check-recurring'
  | 'check-card'
  | 'check-reserve'
  | 'close-month'
  | 'first-income'
  | 'first-expense'
  | 'setup-categories'
  | 'first-reminder'
  | 'enable-push'
  | 'install-app'
  | 'connect-bank'
  | `meet-${ModuleKey}`;

/** What the server knows about an account, to tell which missions apply and which are done. */
export interface MissionFacts {
  incomeThisMonth: boolean;
  /**
   * An expense the person put in this month — not the charges of an older parcelled purchase,
   * which the month gets by itself when it is created — or a card purchase registered this month.
   */
  expenseThisMonth: boolean;
  anyIncome: boolean;
  anyExpense: boolean;
  anyReminder: boolean;
  anyCard: boolean;
  anyRecurring: boolean;
  anyPushDevice: boolean;
  anyBankConnection: boolean;
  /** Whether last month is closed; null when the account has no last month. */
  previousMonthClosed: boolean | null;
}

export interface MissionDefinition {
  key: MissionKey;
  /** Short: it is the whole text of the mission (~30 characters at most). */
  title: string;
  xp: number;
  period: MissionPeriod;
  /** The module it belongs to: an account without it (a restricted module) never sees it. */
  module?: ModuleKey;
  /**
   * Done by what the account has, which the server checks. Without it, the mission is done by
   * going somewhere, which the app reports (`visitsForPath`) — honest by nature: it is the use.
   */
  done?: (facts: MissionFacts) => boolean;
  /** Only offered while this holds: a bill to check needs a card. */
  when?: (facts: MissionFacts) => boolean;
}

/**
 * "Conhecer …": the first visit to each module's screen; for one without a screen, its place (the
 * "A receber" list of Lançamentos), which the app reports.
 */
const MEET: MissionDefinition[] = MODULES.map((definition) => ({
  key: `meet-${definition.key}` as const,
  title: `Conhecer ${definition.screen?.label ?? definition.name}`,
  xp: 20,
  period: 'once' as const,
  module: definition.key,
}));

/** Every mission, in the order they are offered: the first-time ones, then the month's, the week's and the day's. */
export const MISSIONS: MissionDefinition[] = [
  { key: 'first-income', title: 'Registrar a primeira renda', xp: 50, period: 'once', module: 'expenses', done: (f) => f.anyIncome },
  { key: 'first-expense', title: 'Lançar o primeiro gasto', xp: 50, period: 'once', module: 'expenses', done: (f) => f.anyExpense },
  // Done on "Concluir configuração" of the categories' questions, even keeping the % as they were.
  { key: 'setup-categories', title: 'Ajustar suas categorias', xp: 50, period: 'once', module: 'budget' },
  { key: 'first-reminder', title: 'Criar o primeiro lembrete', xp: 30, period: 'once', module: 'reminders', done: (f) => f.anyReminder },
  { key: 'enable-push', title: 'Ligar as notificações', xp: 30, period: 'once', done: (f) => f.anyPushDevice },
  { key: 'install-app', title: 'Instalar o app no celular', xp: 30, period: 'once' },
  { key: 'connect-bank', title: 'Conectar um banco', xp: 100, period: 'once', module: 'banks', done: (f) => f.anyBankConnection },
  { key: 'month-income', title: 'Registrar uma renda', xp: 30, period: 'month', module: 'expenses', done: (f) => f.incomeThisMonth },
  { key: 'month-expense', title: 'Lançar um gasto', xp: 30, period: 'month', module: 'expenses', done: (f) => f.expenseThisMonth },
  { key: 'check-calendar', title: 'Conferir o calendário', xp: 15, period: 'month', module: 'reminders' },
  { key: 'check-recurring', title: 'Conferir as contas do mês', xp: 15, period: 'month', module: 'recurring', when: (f) => f.anyRecurring },
  { key: 'check-card', title: 'Conferir a fatura', xp: 15, period: 'month', module: 'card', when: (f) => f.anyCard },
  { key: 'check-reserve', title: 'Conferir a reserva', xp: 15, period: 'month', module: 'cash' },
  {
    key: 'close-month',
    title: 'Fechar o mês anterior',
    xp: 50,
    period: 'month',
    module: 'budget',
    when: (f) => f.previousMonthClosed !== null,
    done: (f) => f.previousMonthClosed === true,
  },
  { key: 'check-banks', title: 'Conferir os bancos', xp: 15, period: 'week', module: 'banks', when: (f) => f.anyBankConnection },
  // Not by just opening the app: the person taps "Resgatar" on the Missões bar of the Início. The
  // key is the old one, so a day already earned by opening counts as claimed.
  { key: 'open-app', title: 'Resgatar o XP do dia', xp: 10, period: 'day' },
  ...MEET,
];

const BY_KEY = new Map(MISSIONS.map((mission) => [mission.key, mission]));

export function missionDefinition(key: string): MissionDefinition | undefined {
  return BY_KEY.get(key as MissionKey);
}

export const isMeetMission = (key: MissionKey) => key.startsWith('meet-');

/**
 * The "Conhecer …" missions of the restricted modules (and of the ones built on them): they never
 * give XP, not even to an account with access — those modules are for testing, not for everyone.
 */
export function restrictedMeetMissions(restricted: ModuleKey[]): MissionKey[] {
  const access = { vip: false, vipModules: restricted };
  return MODULES.filter((definition) => isModuleHidden(access, definition.key)).map(
    (definition) => `meet-${definition.key}` as const,
  );
}

/**
 * The missions this account has now: its modules, and what it has for the conditional ones; never
 * the "Conhecer" of a `restricted` module.
 */
export function availableMissions(
  modules: ModuleFlags,
  facts: MissionFacts,
  restricted: ModuleKey[] = [],
): MissionDefinition[] {
  const excluded = new Set<MissionKey>(restrictedMeetMissions(restricted));
  return MISSIONS.filter(
    (mission) =>
      !excluded.has(mission.key) &&
      (!mission.module || modules[mission.module]) &&
      (!mission.when || mission.when(facts)),
  );
}

/** Of `missions`, the ones whose condition the account's data already meets. */
export function missionsMetByData(missions: MissionDefinition[], facts: MissionFacts): MissionKey[] {
  return missions.filter((mission) => mission.done?.(facts)).map((mission) => mission.key);
}

/** Whether `key` is done by going somewhere (the app reports it) rather than by data. */
export function isVisitMission(key: string): boolean {
  const mission = missionDefinition(key);
  return !!mission && !mission.done;
}

// ---------------------------------------------------------------------------------------------
// Periods, by the server's date in São Paulo
// ---------------------------------------------------------------------------------------------

/** The ISO week of `date` ("2026-W44"): Monday to Sunday, the week of the year's first Thursday is 1. */
export function isoWeek(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  const weekday = target.getUTCDay() || 7;
  // The Thursday of this week decides the year it belongs to.
  target.setUTCDate(target.getUTCDate() + 4 - weekday);
  const weekYear = target.getUTCFullYear();
  const firstDay = Date.UTC(weekYear, 0, 1);
  const week = Math.ceil(((target.getTime() - firstDay) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

/** The period a mission done on `today` (a São Paulo date, "2026-10-26") counts for. */
export function periodOf(period: MissionPeriod, today: string): string {
  if (period === 'day') return today;
  if (period === 'week') return isoWeek(today);
  if (period === 'month') return today.slice(0, 7);
  return 'once';
}

// ---------------------------------------------------------------------------------------------
// What the app shows
// ---------------------------------------------------------------------------------------------

export interface MissionState {
  key: MissionKey;
  title: string;
  xp: number;
  period: MissionPeriod;
  module?: ModuleKey;
  /** Done in the current period (for a once mission, ever). */
  done: boolean;
}

export interface MissionsStatus {
  /** All the XP the account ever earned. */
  xp: number;
  /** The missions it has now, done or not, in catalog order. */
  missions: MissionState[];
  /** The XP of each of the last months, newest first ("2026-10"). */
  months: { month: string; xp: number }[];
  /** What this call just earned, for the celebration. */
  earned: { key: MissionKey; xp: number }[];
  /** The "Você sabia?" of today, shown with the missions. */
  fact?: InvestingFact;
}

/**
 * The missions worth showing on the Início, at most `limit`: the open first-time ones (but the
 * "Conhecer" ones), then the month's, the week's, and only then the "Conhecer" ones.
 */
export function nextMissions(missions: MissionState[], limit = 3): MissionState[] {
  const open = missions.filter((mission) => !mission.done && mission.key !== 'open-app');
  const rank = (mission: MissionState) =>
    isMeetMission(mission.key) ? 4 : mission.period === 'once' ? 0 : mission.period === 'month' ? 1 : 2;
  return [...open].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}

/**
 * The missions done by going to a screen: what `pathname` (with its `search`) counts for. The
 * first visit to a module's screen ("Conhecer …") and the month's checks.
 */
export function visitsForPath(pathname: string, search = ''): MissionKey[] {
  const visits: MissionKey[] = [];
  for (const definition of MODULES) {
    if (definition.screen?.isActive(pathname)) visits.push(`meet-${definition.key}`);
  }
  if (pathname.startsWith('/carteira/recorrentes')) visits.push('check-recurring');
  if (pathname.startsWith('/cartao')) visits.push('check-card');
  if (pathname.startsWith('/carteira/caixa')) visits.push('check-reserve');
  if (pathname.startsWith('/bancos/conferir')) visits.push('check-banks');
  if (pathname.startsWith('/lembretes') && new URLSearchParams(search).get('aba') === 'calendario') {
    visits.push('check-calendar');
  }
  return visits;
}
