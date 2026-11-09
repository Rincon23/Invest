import {
  addDays,
  datesBetween,
  daysInMonth,
  timeToMinutes,
  weekdayOf,
  zonedInstant,
  zonedMoment,
} from './time';
import type {
  DailyTask,
  ISODate,
  Reminder,
  ReminderCompletion,
  ReminderSettings,
  TimeOfDay,
} from './types';

/**
 * How far back an undone weekly or monthly reminder is still owed. Past this it is let go —
 * the bot reset everything daily; two months of "atrasado" is already generous.
 */
export const REMINDER_LOOKBACK_DAYS = 62;

/** The day the reminder was created, in São Paulo. */
export function createdDate(reminder: Reminder): ISODate {
  return zonedMoment(new Date(reminder.createdAt)).date;
}

/** Whether `date` is one of the reminder's due days (daily tasks: every day). */
export function isDueOn(reminder: Reminder, date: ISODate): boolean {
  switch (reminder.kind) {
    case 'once':
      return reminder.date === date;
    case 'daily':
      return true;
    case 'weekly':
      return reminder.weekdays.includes(weekdayOf(date));
    case 'monthly': {
      const [year, month, day] = date.split('-').map(Number);
      return day === Math.min(reminder.dayOfMonth, daysInMonth(year, month));
    }
  }
}

/** Completed due days, per reminder. */
export type CompletionIndex = Map<string, Set<ISODate>>;

export function indexCompletions(completions: ReminderCompletion[]): CompletionIndex {
  const index: CompletionIndex = new Map();
  for (const { reminderId, dueDate } of completions) {
    const days = index.get(reminderId) ?? new Set<ISODate>();
    days.add(dueDate);
    index.set(reminderId, days);
  }
  return index;
}

/**
 * The due days, up to `date` (included), still waiting for "Realizado", oldest first. A one-off
 * appointment is only owed on its own day (it is archived the day after); daily tasks have no
 * due days (see `isTaskOpen`).
 */
export function pendingDueDates(
  reminder: Reminder,
  done: Set<ISODate> | undefined,
  date: ISODate,
): ISODate[] {
  if (reminder.kind === 'daily') return [];
  if (reminder.kind === 'once') {
    return reminder.date === date && !done?.has(date) ? [date] : [];
  }
  const created = createdDate(reminder);
  const lookback = addDays(date, -REMINDER_LOOKBACK_DAYS);
  const from = created > lookback ? created : lookback;
  return datesBetween(from, date).filter((day) => isDueOn(reminder, day) && !done?.has(day));
}

/** A daily task shows up on `date` while it is not done, from the day it was created. */
export function isTaskOpen(task: DailyTask, date: ISODate): boolean {
  return task.completedAt === null && createdDate(task) <= date;
}

/** The time of day a reminder is about (daily tasks have several; their first one). */
export function reminderTime(reminder: Reminder): TimeOfDay {
  return reminder.kind === 'daily' ? (reminder.times[0] ?? '00:00') : reminder.time;
}

// ---------------------------------------------------------------------------
// The day view: what the Lembretes screen and the home card show
// ---------------------------------------------------------------------------

export interface ReminderItem {
  reminder: Reminder;
  /** The due day this item is about. */
  dueDate: ISODate;
  done: boolean;
  /** The oldest undone due day before this one, when there is one. */
  overdueSince: ISODate | null;
}

export interface ReminderDay {
  /** Weekly/monthly reminders owed from earlier days and not due again today. */
  overdue: ReminderItem[];
  /** Due today (done or not), by time. */
  today: ReminderItem[];
  /** Open daily tasks, plus the ones done today (so a wrong tap can be undone). */
  tasks: { task: DailyTask; done: boolean }[];
  /** Due tomorrow, by time. */
  tomorrow: ReminderItem[];
}

function byTime(a: ReminderItem, b: ReminderItem): number {
  return timeToMinutes(reminderTime(a.reminder)) - timeToMinutes(reminderTime(b.reminder));
}

export function reminderDay(
  reminders: Reminder[],
  completions: ReminderCompletion[],
  today: ISODate,
): ReminderDay {
  const index = indexCompletions(completions);
  const tomorrowDate = addDays(today, 1);
  const day: ReminderDay = { overdue: [], today: [], tasks: [], tomorrow: [] };

  for (const reminder of reminders) {
    if (reminder.kind === 'daily') {
      const doneToday =
        reminder.completedAt !== null && zonedMoment(new Date(reminder.completedAt)).date === today;
      if (isTaskOpen(reminder, today) || doneToday) {
        day.tasks.push({ task: reminder, done: doneToday });
      }
      continue;
    }

    const done = index.get(reminder.id);
    const pending = pendingDueDates(reminder, done, today);
    const dueToday = isDueOn(reminder, today) && createdDate(reminder) <= today;

    if (dueToday) {
      day.today.push({
        reminder,
        dueDate: today,
        done: Boolean(done?.has(today)),
        overdueSince: pending[0] && pending[0] < today ? pending[0] : null,
      });
    } else if (pending.length > 0) {
      day.overdue.push({ reminder, dueDate: pending[pending.length - 1], done: false, overdueSince: pending[0] });
    }

    if (isDueOn(reminder, tomorrowDate)) {
      day.tomorrow.push({ reminder, dueDate: tomorrowDate, done: false, overdueSince: null });
    }
  }

  day.today.sort(byTime);
  day.tomorrow.sort(byTime);
  day.overdue.sort((a, b) => (a.overdueSince ?? '').localeCompare(b.overdueSince ?? ''));
  day.tasks.sort(
    (a, b) => Number(a.done) - Number(b.done) || reminderTime(a.task).localeCompare(reminderTime(b.task)),
  );
  return day;
}

// ---------------------------------------------------------------------------
// When to notify
// ---------------------------------------------------------------------------

export type SlotKind =
  /** At the reminder's time, on its due day. */
  | 'due'
  /** Again, at one of the user's repeat times, while it is not done. */
  | 'repeat'
  /** The extra notice before a one-off appointment. */
  | 'advance'
  /** One of a daily task's times. */
  | 'task';

export interface NotificationSlot {
  reminderId: string;
  kind: SlotKind;
  /** The instant to notify. */
  at: Date;
  /** `at` in São Paulo. */
  date: ISODate;
  time: TimeOfDay;
  /** The due day this notification is about (tapping "Realizado" completes up to it). */
  dueDate: ISODate;
  overdueSince: ISODate | null;
}

export interface ScheduleInput {
  reminders: Reminder[];
  completions: ReminderCompletion[];
  settings: ReminderSettings;
}

/**
 * Every notification that falls in the window (`from`, `to`]. The scheduler calls this each
 * minute with the time of its previous run as `from`, so a minute is never skipped and, after
 * the server was down, the missed notifications come out at once (the scheduler keeps only the
 * latest per reminder). Nothing earlier than the reminder's creation is ever returned.
 */
export function notificationSlots(input: ScheduleInput, from: Date, to: Date): NotificationSlot[] {
  const index = indexCompletions(input.completions);
  const { repeatEnabled } = input.settings;
  const repeatTimes = [...input.settings.repeatTimes].sort();
  const days = datesBetween(zonedMoment(from).date, zonedMoment(to).date);
  const slots: NotificationSlot[] = [];

  for (const reminder of input.reminders) {
    const created = new Date(reminder.createdAt).getTime();
    const add = (slot: Omit<NotificationSlot, 'reminderId' | 'at'>) => {
      const at = zonedInstant(slot.date, slot.time);
      if (at > from && at <= to && at.getTime() >= created) {
        slots.push({ reminderId: reminder.id, at, ...slot });
      }
    };
    const repeats = repeatEnabled && reminder.repeat;

    if (reminder.kind === 'daily') {
      for (const date of days) {
        if (!isTaskOpen(reminder, date)) continue;
        for (const time of reminder.times) {
          add({ kind: 'task', date, time, dueDate: date, overdueSince: null });
        }
      }
      continue;
    }

    const done = index.get(reminder.id);

    if (reminder.kind === 'once') {
      if (done?.has(reminder.date)) continue;
      const base = { dueDate: reminder.date, overdueSince: null };
      if (reminder.notifyBeforeMinutes) {
        const event = zonedInstant(reminder.date, reminder.time);
        const notice = zonedMoment(new Date(event.getTime() - reminder.notifyBeforeMinutes * 60_000));
        const time = `${String(Math.floor(notice.minutes / 60)).padStart(2, '0')}:${String(notice.minutes % 60).padStart(2, '0')}`;
        add({ kind: 'advance', date: notice.date, time, ...base });
      }
      add({ kind: 'due', date: reminder.date, time: reminder.time, ...base });
      if (repeats) {
        for (const time of repeatTimes) {
          if (time > reminder.time) add({ kind: 'repeat', date: reminder.date, time, ...base });
        }
      }
      continue;
    }

    for (const date of days) {
      const pending = pendingDueDates(reminder, done, date);
      if (pending.length === 0) continue;
      const latest = pending[pending.length - 1];
      const overdueSince = pending[0] < date ? pending[0] : null;

      if (latest === date) {
        add({ kind: 'due', date, time: reminder.time, dueDate: date, overdueSince });
      }
      if (repeats) {
        for (const time of repeatTimes) {
          // On the due day, only after the reminder's own time; on later days, all of them.
          if (latest === date && time <= reminder.time) continue;
          add({ kind: 'repeat', date, time, dueDate: latest, overdueSince });
        }
      }
    }
  }

  return slots.sort((a, b) => a.at.getTime() - b.at.getTime());
}
