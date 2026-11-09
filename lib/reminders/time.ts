import type { ISODate, TimeOfDay } from './types';

/**
 * Calendar math in São Paulo, independent of the machine's own time zone: the server, the
 * tests and every phone agree on what "today at 08:00" is.
 */
export const APP_TIME_ZONE = 'America/Sao_Paulo';

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY.test(value);
}

export function timeToMinutes(time: TimeOfDay): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Valid times, without repeats, in order. */
export function normalizeTimes(times: TimeOfDay[]): TimeOfDay[] {
  return [...new Set(times.filter(isTimeOfDay))].sort();
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(instant: Date): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The day and the minute of the day of `instant`, in São Paulo. */
export function zonedMoment(instant: Date): { date: ISODate; minutes: number } {
  const p = zonedParts(instant);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, minutes: p.hour * 60 + p.minute };
}

export function zonedToday(now: Date = new Date()): ISODate {
  return zonedMoment(now).date;
}

/** The instant `date` at `time` in São Paulo. */
export function zonedInstant(date: ISODate, time: TimeOfDay): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset at that moment, measured by reading the UTC guess back in the zone.
  const offset = (instant: number) => {
    const p = zonedParts(new Date(instant));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(instant / 60_000) * 60_000;
  };
  // Measured twice, so a day on which the offset changes (daylight saving) still lands right.
  return new Date(asUtc - offset(asUtc - offset(asUtc)));
}

export function addDays(date: ISODate, days: number): ISODate {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(date: ISODate): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Every day from `from` to `to`, both included (empty when `to` is before `from`). */
export function datesBetween(from: ISODate, to: ISODate): ISODate[] {
  const dates: ISODate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** "16/09" */
export function formatDayMonth(date: ISODate): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

/** "16/09/2026" */
export function formatFullDate(date: ISODate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
