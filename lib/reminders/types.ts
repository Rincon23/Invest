/** "YYYY-MM-DD", a calendar day in São Paulo. */
export type ISODate = string;
/** "HH:MM", 24 h. */
export type TimeOfDay = string;

export type ReminderKind = 'once' | 'daily' | 'weekly' | 'monthly';

interface ReminderFields {
  id: string;
  message: string;
  /**
   * Remind again at the user's "horários para lembrar de novo" while it is not done. Ignored by
   * daily tasks, whose own times already repeat every day.
   */
  repeat: boolean;
}

/** A one-off appointment: a date and a time, archived the day after. */
export interface OnceReminderInput extends ReminderFields {
  kind: 'once';
  date: ISODate;
  time: TimeOfDay;
  /** Extra notice before the time: 30, 60 or 1440 (one day) minutes, or none. */
  notifyBeforeMinutes: number | null;
}

/** A to-do that shows up every day, at the chosen times, until it is done (then archived). */
export interface DailyTaskInput extends ReminderFields {
  kind: 'daily';
  times: TimeOfDay[];
}

export interface WeeklyReminderInput extends ReminderFields {
  kind: 'weekly';
  /** 0 = domingo … 6 = sábado. */
  weekdays: number[];
  time: TimeOfDay;
}

/** Monthly on `dayOfMonth`; a month without that day (31 in April) uses its last day. */
export interface MonthlyReminderInput extends ReminderFields {
  kind: 'monthly';
  dayOfMonth: number;
  time: TimeOfDay;
}

/** What the form sends. */
export type ReminderInput =
  | OnceReminderInput
  | DailyTaskInput
  | WeeklyReminderInput
  | MonthlyReminderInput;

interface StoredFields {
  /** When it was created (ISO instant). Nothing before it is ever notified or owed. */
  createdAt: string;
}

export type OnceReminder = OnceReminderInput & StoredFields;
export type DailyTask = DailyTaskInput & StoredFields & {
  /** When the task was done; a done task is archived (it leaves the lists, stays in history). */
  completedAt: string | null;
};
export type WeeklyReminder = WeeklyReminderInput & StoredFields;
export type MonthlyReminder = MonthlyReminderInput & StoredFields;

export type Reminder = OnceReminder | DailyTask | WeeklyReminder | MonthlyReminder;

/** "Realizado" for one due day of a once / weekly / monthly reminder. */
export interface ReminderCompletion {
  reminderId: string;
  dueDate: ISODate;
}

/** Each user's own notification preferences (nothing here is fixed to anyone's routine). */
export interface ReminderSettings {
  /** Master switch for reminding again until done. */
  repeatEnabled: boolean;
  /** When to remind again, sorted "HH:MM". */
  repeatTimes: TimeOfDay[];
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  repeatEnabled: true,
  repeatTimes: ['08:00', '12:00', '15:00', '18:00'],
};

/** The extra notices a one-off appointment can have. */
export const NOTIFY_BEFORE_OPTIONS = [30, 60, 1440] as const;
