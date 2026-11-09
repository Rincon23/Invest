import { round2, sum } from './money';
import { addDays, daysBetween } from './cards';
import { previousMonth } from './date';
import type { InstallmentPlan, Month, RecurringExpense, RecurringSettings } from './types';

/**
 * "Contas do mês": the recurring templates seen as a checklist of the month. A template knows the
 * day it falls due (optional, like everything in Capital) and whether it was already launched in
 * a competence — an expense made from it ("Lançar", in the app or from the notification) carries
 * `recurringId`, and so does a parcelled purchase made from a parcelled template. Nothing here is
 * stored: deleting the expense puts the bill back on the list, as it should.
 */

/** One launch of a template: an expense (or a parcelled purchase) made from it, and its competence. */
export interface RecurringLaunch {
  recurringId: string;
  month: Month;
  /** The day it was launched (the expense's date, or the purchase date of a parcelled one). */
  date: string;
}

export const DEFAULT_RECURRING_SETTINGS: RecurringSettings = {
  notifyEnabled: true,
  notifyTime: '09:00',
  repeatUntilLaunched: true,
};

/** How many days after the due date a bill still not launched keeps being remembered. */
export const RECURRING_LATE_NOTICE_DAYS = 3;

/** The highest day a template can fall due on; 29–31 fall on the last day of shorter months. */
export const MAX_DUE_DAY = 31;

function lastDayOfMonth(month: Month): number {
  const [year, monthNum] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
}

/** The day a template falls due in `month`: its day, or the last day of a short month. */
export function recurringDueDate(month: Month, dueDay: number): string {
  const day = Math.min(Math.max(1, Math.trunc(dueDay)), lastDayOfMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** The launches the parcelled purchases made from a template stand for: one, in the purchase month. */
export function launchesFromPlans(plans: InstallmentPlan[]): RecurringLaunch[] {
  return plans
    .filter((plan) => plan.recurringId)
    .map((plan) => {
      const date = plan.purchaseDate ?? plan.firstDebitDate;
      return { recurringId: plan.recurringId as string, month: date.slice(0, 7), date };
    });
}

export interface RecurringStatus {
  item: RecurringExpense;
  /** When it falls due in the month on screen; null when the person did not say. */
  dueDate: string | null;
  /** Days from today to `dueDate` (negative: late); null without a due day. */
  daysUntilDue: number | null;
  /** The day it was launched in this month, or null while it is still to launch. */
  launchedOn: string | null;
}

export interface RecurringChecklist {
  /** Still to launch, the next to fall due first; the ones without a day come last, in their order. */
  pending: RecurringStatus[];
  /** Already launched this month, in the order they were launched. */
  done: RecurringStatus[];
  /** What the pending ones add up to. */
  pendingTotal: number;
  /** What every template adds up to. */
  total: number;
}

/** Where each template of `month` stands, as of `today`. */
export function recurringChecklist(
  items: RecurringExpense[],
  launches: RecurringLaunch[],
  month: Month,
  today: string,
): RecurringChecklist {
  const launchedOn = new Map<string, string>();
  for (const launch of launches) {
    if (launch.month !== month) continue;
    const previous = launchedOn.get(launch.recurringId);
    if (!previous || launch.date < previous) launchedOn.set(launch.recurringId, launch.date);
  }

  const statuses = items.map((item): RecurringStatus => {
    const dueDate = item.dueDay ? recurringDueDate(month, item.dueDay) : null;
    return {
      item,
      dueDate,
      daysUntilDue: dueDate ? daysBetween(today, dueDate) : null,
      launchedOn: launchedOn.get(item.id) ?? null,
    };
  });

  const pending = statuses
    .filter((status) => status.launchedOn === null)
    // A stable sort: the ones without a day keep the order the person gave them.
    .sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    });
  const done = statuses
    .filter((status) => status.launchedOn !== null)
    .sort((a, b) => ((a.launchedOn as string) < (b.launchedOn as string) ? -1 : 1));

  return {
    pending,
    done,
    pendingTotal: round2(sum(pending.map((status) => status.item.amount))),
    total: round2(sum(items.map((item) => item.amount))),
  };
}

/** "vence hoje", "venceu dia 5", "vence dia 10" — how a pending bill's day reads in the list. */
export function recurringDueLabel(status: Pick<RecurringStatus, 'dueDate' | 'daysUntilDue'>): string | null {
  if (status.dueDate === null || status.daysUntilDue === null) return null;
  const day = Number(status.dueDate.slice(8, 10));
  if (status.daysUntilDue === 0) return 'vence hoje';
  if (status.daysUntilDue === 1) return 'vence amanhã';
  if (status.daysUntilDue < 0) return `venceu dia ${day}`;
  return `vence dia ${day}`;
}

/** One day a bill of "Contas do mês" is worth a notice: the day it falls due, or a day after. */
export interface RecurringNoticeDay {
  item: RecurringExpense;
  month: Month;
  dueDate: string;
  kind: 'due' | 'late';
  /** The day the notice goes out (the due date, or up to `RECURRING_LATE_NOTICE_DAYS` after). */
  date: string;
}

/**
 * The days the bills of `month` — and, for a late notice that crosses into a new month, of the
 * month before — are worth a notice, while they are not launched in their own competence. A bill
 * without a due day never notifies (there is no day to warn about), nor does any bill when the
 * person turned the notices off.
 */
export function recurringNoticeDays(
  items: RecurringExpense[],
  launches: RecurringLaunch[],
  settings: RecurringSettings,
  month: Month,
): RecurringNoticeDay[] {
  if (!settings.notifyEnabled) return [];
  const launched = new Set(launches.map((launch) => `${launch.recurringId}:${launch.month}`));
  const days: RecurringNoticeDay[] = [];
  for (const competence of [previousMonth(month), month]) {
    for (const item of items) {
      if (!item.dueDay || launched.has(`${item.id}:${competence}`)) continue;
      const dueDate = recurringDueDate(competence, item.dueDay);
      days.push({ item, month: competence, dueDate, kind: 'due', date: dueDate });
      if (!settings.repeatUntilLaunched) continue;
      for (let late = 1; late <= RECURRING_LATE_NOTICE_DAYS; late += 1) {
        days.push({ item, month: competence, dueDate, kind: 'late', date: addDays(dueDate, late) });
      }
    }
  }
  return days;
}

/** The body of a notice: "Vence hoje: R$ 180,00. …" or "Venceu ontem (dia 10): R$ 180,00. …" */
export function recurringNoticeBody(
  day: Pick<RecurringNoticeDay, 'kind' | 'dueDate' | 'date'>,
  amount: string,
): string {
  if (day.kind === 'due') return `Vence hoje: ${amount}. Toque em Lançar quando pagar.`;
  const late = daysBetween(day.dueDate, day.date);
  const when = late === 1 ? 'ontem' : `há ${late} dias`;
  return `Venceu ${when} (dia ${Number(day.dueDate.slice(8, 10))}): ${amount}. Ainda não foi lançada.`;
}
