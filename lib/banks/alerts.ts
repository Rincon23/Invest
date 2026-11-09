import { previousMonth } from '../budget/date';
import type { Month } from '../budget/types';

/**
 * Open Finance alerts: after a bank sends data, one alert per bank only when it brought something
 * to check — what is new and missing in the Capital this month or the last, as the month's check
 * counts it. Honest about the delay: the banks send data once a day, so nothing here says "agora".
 */

/** What to tell about, set in the module's gear. */
export interface BankAlertSettings {
  /** Money out and card purchases that are not in the Capital yet. */
  expenses: boolean;
  /** Money in that is not in the Capital yet. */
  incomes: boolean;
  /** Reaches the phone's tray and the app's list without sound or vibration. */
  silent: boolean;
}

export const DEFAULT_BANK_ALERTS: BankAlertSettings = {
  expenses: true,
  incomes: true,
  silent: false,
};

/**
 * The settings as saved. An older save had switches for card purchases, Pix sent and Pix received
 * and a minimum amount: money out is told when purchases or Pix sent were, money in when Pix
 * received was; the minimum is gone.
 */
export function alertSettingsOf(saved: Record<string, unknown> | null | undefined): BankAlertSettings {
  const read = (key: string) => (typeof saved?.[key] === 'boolean' ? (saved[key] as boolean) : null);
  const purchases = read('purchases');
  const pixSent = read('pixSent');
  return {
    expenses:
      read('expenses') ??
      (purchases === null && pixSent === null ? DEFAULT_BANK_ALERTS.expenses : (purchases ?? true) || (pixSent ?? true)),
    incomes: read('incomes') ?? read('pixReceived') ?? DEFAULT_BANK_ALERTS.incomes,
    silent: read('silent') ?? DEFAULT_BANK_ALERTS.silent,
  };
}

/** What one read of a bank brought that is missing in the Capital, month by month. */
export interface ReviewNews {
  month: Month;
  expenses: number;
  incomes: number;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * "3 gastos e 1 recebimento para conferir.", under the person's settings. Null when there is
 * nothing to tell: no alert at all then.
 */
export function reviewAlertBody(news: ReviewNews[], settings: BankAlertSettings): string | null {
  const expenses = settings.expenses ? news.reduce((sum, month) => sum + month.expenses, 0) : 0;
  const incomes = settings.incomes ? news.reduce((sum, month) => sum + month.incomes, 0) : 0;
  const parts = [
    expenses > 0 ? plural(expenses, 'gasto', 'gastos') : null,
    incomes > 0 ? plural(incomes, 'recebimento', 'recebimentos') : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return `${parts.join(' e ')} para conferir.`;
}

/**
 * Where tapping the alert goes: the tab with more to check, in the month that has it (this month,
 * unless everything new is last month's).
 */
export function reviewAlertUrl(base: string, news: ReviewNews[], settings: BankAlertSettings, current: Month): string {
  const count = (month: ReviewNews) =>
    (settings.expenses ? month.expenses : 0) + (settings.incomes ? month.incomes : 0);
  const expenses = settings.expenses ? news.reduce((sum, month) => sum + month.expenses, 0) : 0;
  const incomes = settings.incomes ? news.reduce((sum, month) => sum + month.incomes, 0) : 0;
  const onlyLast = news.every((month) => month.month !== current || count(month) === 0);
  const tab = incomes > expenses ? 'recebimentos' : 'gastos';
  return `${base}?tipo=${tab}${onlyLast ? `&mes=${previousMonth(current)}` : ''}`;
}
