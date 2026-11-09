import type { Month } from './types';

/** Current competence month key ("YYYY-MM") for a given date (defaults to now). */
export function currentMonthKey(date: Date = new Date()): Month {
  const year = date.getFullYear();
  const monthNum = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${monthNum}`;
}

/**
 * Today's date as ISO "YYYY-MM-DD" in the local time zone. Not `toISOString()`: that is
 * UTC, which in Brazil already reads as tomorrow from 21:00 on.
 */
export function todayISO(date: Date = new Date()): string {
  const year = date.getFullYear();
  const monthNum = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${monthNum}-${day}`;
}

/** Shifts a "YYYY-MM" month key by `delta` months (can be negative). */
export function shiftMonth(month: Month, delta: number): Month {
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNum - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousMonth(month: Month): Month {
  return shiftMonth(month, -1);
}

export function nextMonth(month: Month): Month {
  return shiftMonth(month, 1);
}

const MONTH_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/** "2026-09" -> "Setembro 2026" */
export function formatMonthLabel(month: Month): string {
  const [year, monthNum] = month.split('-').map(Number);
  return `${MONTH_LABELS[monthNum - 1]} ${year}`;
}

/** "2026-09" -> "Setembro": the month alone, for lines about this month or the last. */
export function formatMonthName(month: Month): string {
  return MONTH_LABELS[Number(month.split('-')[1]) - 1];
}

/** "2026-09" -> "set/26", for compact chart axes. */
export function formatMonthShort(month: Month): string {
  const [year, monthNum] = month.split('-').map(Number);
  return `${MONTH_LABELS[monthNum - 1].slice(0, 3).toLowerCase()}/${String(year).slice(2)}`;
}
