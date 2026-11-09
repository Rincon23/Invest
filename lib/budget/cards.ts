import { currentMonthKey, nextMonth, todayISO } from './date';
import { round2, sum } from './money';
import type { CardBillPayment, CardSettings, CreditCard, Month } from './types';

/**
 * The cards and their bills (module "Cartão").
 *
 * A bill is the pair (card, competence), and **no bill ever leaves on its own**: it stays a debt
 * until the person taps "Fatura paga", however late it gets. That is true of a registered card
 * and just as true of the purchases where nobody said which card it was — those form the
 * "Não informado" bill (`UNASSIGNED_CARD_ID`), which works exactly like a card's, with a single
 * difference: it has no due date, so there is nothing to warn about.
 *
 * Nothing here is stored: the due date, the postponement off a weekend and how late a bill is
 * all come from the card's `dueDay` and today's date. What each bill is worth is the other half
 * of the module and lives in `bill.ts`.
 */

export const DEFAULT_CARD_SETTINGS: CardSettings = {
  notifyTime: '09:00',
  repeatUntilPaid: true,
};

/** How many days before the due date the extra notice can go out (0 = only on the day). */
export const CARD_NOTIFY_BEFORE_OPTIONS = [0, 1, 2, 3, 5, 7] as const;

/**
 * The bill of the purchases nobody said the card of. Card ids are UUIDs, so this constant never
 * collides with one, and it is what `card_bill_payments.card_id` holds for that bill.
 */
export const UNASSIGNED_CARD_ID = 'nao-informado';

/** How that bill is called, everywhere — never "Sem cartão". */
export const UNASSIGNED_CARD_LABEL = 'Não informado';

/** A card that notifies more than a week late is let go — nobody needs a daily nag forever. */
export const LATE_NOTICE_DAYS = 7;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function lastDayOfMonth(month: Month): number {
  const [year, monthNum] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
}

/** `date` shifted by `days`, on "YYYY-MM-DD" strings (UTC math, so no time zone is involved). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Whole days from `from` to `to`: 0 the same day, negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/**
 * Saturdays and Sundays are not banking days: a bill due on one is paid on the Monday. It may
 * land in the next month (a Sunday the 31st becomes the 1st) — that is right, and it never
 * changes which competence the bill belongs to. Holidays are not considered: they would need a
 * calendar the app does not have.
 */
export function nextBankingDay(date: string): string {
  const weekday = weekdayOf(date);
  if (weekday === 6) return addDays(date, 2);
  if (weekday === 0) return addDays(date, 1);
  return date;
}

/** The card's day for the bill of `month`, before the weekend is taken into account. */
export function nominalDueDate(card: Pick<CreditCard, 'dueDay' | 'dueMonth'>, month: Month): string {
  const target = card.dueMonth === 'same' ? month : nextMonth(month);
  return `${target}-${pad(Math.min(card.dueDay, lastDayOfMonth(target)))}`;
}

/** The day the bill of `month` is actually paid on: the card's day, off the weekend. */
export function billDueDate(card: Pick<CreditCard, 'dueDay' | 'dueMonth'>, month: Month): string {
  return nextBankingDay(nominalDueDate(card, month));
}

/**
 * The day the next charge on `card` falls on: its own day in the current competence while that
 * has not passed, the next competence's afterwards. Always the card's own day, never the one
 * pushed off a weekend — every later instalment is "first charge + k months", so starting from a
 * postponed day would drag the whole series along.
 */
export function nextChargeDate(card: Pick<CreditCard, 'dueDay' | 'dueMonth'>, today = todayISO()): string {
  const month = currentMonthKey(new Date(`${today}T12:00:00`));
  const due = nominalDueDate(card, month);
  return due >= today ? due : nominalDueDate(card, nextMonth(month));
}

/** What each card owes in one competence, as the bill math groups it. */
export interface CardBillTotal {
  month: Month;
  /** A registered card's id, or `UNASSIGNED_CARD_ID`. */
  cardId: string;
  total: number;
}

/** One bill, ready for the screens. */
export interface CardBill {
  /** A registered card's id, or `UNASSIGNED_CARD_ID`. */
  cardId: string;
  cardName: string;
  month: Month;
  total: number;
  paid: boolean;
  /** ISO instant of "Fatura paga". */
  paidAt: string | null;
  /** The day it is paid on (the card's day, off the weekend); null for "Não informado". */
  dueDate: string | null;
  /** The card's own day, when the weekend pushed the bill off it. */
  postponedFrom: string | null;
  /** Days from today to `dueDate`: 0 today, negative when it is late. */
  daysUntilDue: number | null;
  /** A competence after the current one: already committed, but not a bill to pay yet. */
  future: boolean;
}

export function isUnassignedCard(cardId: string): boolean {
  return cardId === UNASSIGNED_CARD_ID;
}

export function billKey(bill: Pick<CardBill, 'cardId' | 'month'>): string {
  return `${bill.cardId}:${bill.month}`;
}

/** The name to show for a bill's card: the registered one, or "Não informado". */
export function cardNameOf(cards: CreditCard[], cardId: string): string {
  return cards.find((card) => card.id === cardId)?.name ?? UNASSIGNED_CARD_LABEL;
}

/**
 * Every bill worth showing: the open ones of each card (however old), the ones already paid (so
 * the screen can say so) and the "Não informado" bill, which behaves like all the others. A
 * competence later than the current one is marked `future`: it is committed money, but there is
 * nothing to pay there yet. Ordered by the day they have to be paid.
 */
export function cardBills(
  cards: CreditCard[],
  totals: CardBillTotal[],
  payments: CardBillPayment[],
  today: string,
): CardBill[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const paidAt = new Map(payments.map((payment) => [`${payment.cardId}:${payment.month}`, payment.paidAt]));
  const current = today.slice(0, 7);
  // A card that no longer exists falls back to "Não informado", with the untagged purchases.
  const unassigned = new Map<Month, number>();
  const bills: CardBill[] = [];

  for (const row of totals) {
    const total = round2(row.total);
    if (total <= 0) continue;
    const card = byId.get(row.cardId);
    if (!card) {
      unassigned.set(row.month, round2((unassigned.get(row.month) ?? 0) + total));
      continue;
    }
    const nominal = nominalDueDate(card, row.month);
    const dueDate = nextBankingDay(nominal);
    const when = paidAt.get(`${card.id}:${row.month}`) ?? null;
    bills.push({
      cardId: card.id,
      cardName: card.name,
      month: row.month,
      total,
      paid: when !== null,
      paidAt: when,
      dueDate,
      postponedFrom: dueDate === nominal ? null : nominal,
      daysUntilDue: daysBetween(today, dueDate),
      future: row.month > current,
    });
  }

  for (const [month, total] of unassigned) {
    const when = paidAt.get(`${UNASSIGNED_CARD_ID}:${month}`) ?? null;
    bills.push({
      cardId: UNASSIGNED_CARD_ID,
      cardName: UNASSIGNED_CARD_LABEL,
      month,
      total,
      paid: when !== null,
      paidAt: when,
      dueDate: null,
      postponedFrom: null,
      daysUntilDue: null,
      future: month > current,
    });
  }

  return bills.sort((a, b) => {
    const dayA = a.dueDate ?? `${a.month}-99`;
    const dayB = b.dueDate ?? `${b.month}-99`;
    return dayA.localeCompare(dayB) || a.cardName.localeCompare(b.cardName, 'pt-BR');
  });
}

/** The bills still to pay: not marked as paid, and of a competence that already closed. */
export function openBills(bills: CardBill[]): CardBill[] {
  return bills.filter((bill) => !bill.paid && !bill.future);
}

/** What the cards still owe, as a negative number, for the cash report. */
export function openCardDebt(bills: CardBill[]): number {
  return -round2(sum(openBills(bills).map((bill) => bill.total)));
}

/** The open bill to be paid first; "Não informado" waits, since it has no date of its own. */
export function nextBillToPay(bills: CardBill[]): CardBill | null {
  const open = openBills(bills);
  return open.find((bill) => bill.dueDate !== null) ?? open[0] ?? null;
}

/** Open bills already past their day. */
export function lateBills(bills: CardBill[]): CardBill[] {
  return openBills(bills).filter((bill) => bill.daysUntilDue !== null && bill.daysUntilDue < 0);
}

/** "vence hoje", "vence em 3 dias", "atrasada há 2 dias", "sem data de vencimento". */
export function dueLabel(bill: CardBill): string {
  if (bill.paid) return bill.paidAt ? `paga em ${formatDayMonth(bill.paidAt.slice(0, 10))}` : 'paga';
  if (bill.daysUntilDue === null) return 'sem data de vencimento';
  if (bill.daysUntilDue === 0) return 'vence hoje';
  if (bill.daysUntilDue === 1) return 'vence amanhã';
  if (bill.daysUntilDue > 1) return `vence em ${bill.daysUntilDue} dias`;
  const late = -bill.daysUntilDue;
  return late === 1 ? 'atrasada há 1 dia' : `atrasada há ${late} dias`;
}

/**
 * How the bill stands, in a few words, without repeating the due date the screen already shows:
 * "paga em 02/10", "atrasada há 3 dias", "vence hoje", "ainda vai fechar" or "em aberto".
 */
export function billStateLabel(bill: CardBill): string {
  if (bill.paid) return bill.paidAt ? `paga em ${formatDayMonth(bill.paidAt.slice(0, 10))}` : 'paga';
  if (bill.future) return 'ainda vai fechar';
  if (bill.daysUntilDue === null) return 'em aberto';
  if (bill.daysUntilDue === 0) return 'vence hoje';
  if (bill.daysUntilDue > 0) return 'em aberto';
  const late = -bill.daysUntilDue;
  return late === 1 ? 'atrasada há 1 dia' : `atrasada há ${late} dias`;
}

/** How the bill's state should be coloured on the screen. */
export type BillTone = 'paid' | 'late' | 'due' | 'open';

export function billTone(bill: CardBill): BillTone {
  if (bill.paid) return 'paid';
  if (bill.daysUntilDue === null) return 'open';
  if (bill.daysUntilDue < 0) return 'late';
  if (bill.daysUntilDue === 0) return 'due';
  return 'open';
}

/** "2026-09-04" -> "04/09". */
export function formatDayMonth(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

/** The days a bill is notified on: the notice before, the due day itself, and the late nagging. */
export function billNoticeDays(
  card: Pick<CreditCard, 'dueDay' | 'dueMonth' | 'notifyBeforeDays'>,
  month: Month,
  settings: CardSettings,
): { advance: string | null; due: string; late: string[] } {
  const due = billDueDate(card, month);
  const late = settings.repeatUntilPaid
    ? Array.from({ length: LATE_NOTICE_DAYS }, (_, index) => addDays(due, index + 1))
    : [];
  return {
    advance: card.notifyBeforeDays > 0 ? addDays(due, -card.notifyBeforeDays) : null,
    due,
    late,
  };
}

/** What a card's limit still has room for, and whether the purchases went past it. */
export interface CardLimitUse {
  limit: number;
  /** Open bills of this card plus the instalments that have not been charged yet. */
  used: number;
  /** `limit − used`; negative means the card is over its limit. */
  available: number;
  /** used / limit, capped at 1 for the bar. */
  usedPct: number;
  over: boolean;
}

/**
 * How much of the limit is free: what the open bills of this card add up to and what its future
 * instalments will still bring, both taken off the limit. A card without a limit shows nothing
 * at all, so this is only ever called with one.
 */
export function cardLimitUse(limit: number, openTotal: number, futureInstallments: number): CardLimitUse {
  const used = round2(openTotal + futureInstallments);
  const available = round2(limit - used);
  return {
    limit,
    used,
    available,
    usedPct: limit > 0 ? Math.min(Math.max(used / limit, 0), 1) : 1,
    over: available < 0,
  };
}
