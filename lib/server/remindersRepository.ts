import { and, eq, gte, sql } from 'drizzle-orm';
import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_LOOKBACK_DAYS,
  addDays,
  isDueOn,
  normalizeTimes,
  pendingDueDates,
  zonedToday,
  type Reminder,
  type ReminderCompletion,
  type ReminderInput,
  type ReminderSettings,
  type ScheduleInput,
} from '../reminders';
import type { RemindersRepository, RemindersSnapshot } from '../storage/reminders';
import { reminderCompletions, reminderSettings, reminders } from './db/schema';
import type { Database } from './db/types';
import { HttpError } from './httpError';
import { checkQuota, QUOTAS } from './quotas';

type ReminderRow = typeof reminders.$inferSelect;

function toReminder(row: ReminderRow): Reminder {
  const base = {
    id: row.id,
    message: row.message,
    repeat: row.repeat,
    createdAt: row.createdAt.toISOString(),
  };
  switch (row.kind) {
    case 'once':
      return {
        ...base,
        kind: 'once',
        date: row.date ?? '',
        time: row.time ?? '00:00',
        notifyBeforeMinutes: row.notifyBeforeMinutes,
      };
    case 'daily':
      return {
        ...base,
        kind: 'daily',
        times: row.times,
        completedAt: row.completedAt?.toISOString() ?? null,
      };
    case 'weekly':
      return { ...base, kind: 'weekly', weekdays: row.weekdays, time: row.time ?? '00:00' };
    case 'monthly':
      return { ...base, kind: 'monthly', dayOfMonth: row.dayOfMonth ?? 1, time: row.time ?? '00:00' };
  }
}

/** The columns for one reminder; the ones its kind does not use are cleared. */
function columnsFor(input: ReminderInput) {
  const empty = {
    date: null,
    time: null,
    times: [] as string[],
    weekdays: [] as number[],
    dayOfMonth: null,
    notifyBeforeMinutes: null,
  };
  const common = { kind: input.kind, message: input.message.trim(), repeat: input.repeat };
  switch (input.kind) {
    case 'once':
      return {
        ...empty,
        ...common,
        date: input.date,
        time: input.time,
        notifyBeforeMinutes: input.notifyBeforeMinutes,
      };
    case 'daily':
      return { ...empty, ...common, times: normalizeTimes(input.times) };
    case 'weekly':
      return {
        ...empty,
        ...common,
        weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b),
        time: input.time,
      };
    case 'monthly':
      return { ...empty, ...common, dayOfMonth: input.dayOfMonth, time: input.time };
  }
}

/** Lembretes on Postgres, scoped to one user. */
export class PostgresRemindersRepository implements RemindersRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {}

  async getSnapshot(now: Date = new Date()): Promise<RemindersSnapshot> {
    const today = zonedToday(now);
    const [list, completions, settings] = await Promise.all([
      this.listReminders(),
      this.listCompletions(addDays(today, -REMINDER_LOOKBACK_DAYS)),
      this.getSettings(),
    ]);
    return { reminders: list, completions, settings, today };
  }

  /** What the scheduler needs: the reminders that can still notify, and what is already done. */
  async loadSchedule(now: Date = new Date()): Promise<ScheduleInput> {
    const today = zonedToday(now);
    const yesterday = addDays(today, -1);
    const [list, completions, settings] = await Promise.all([
      this.listReminders(),
      this.listCompletions(addDays(today, -REMINDER_LOOKBACK_DAYS - 1)),
      this.getSettings(),
    ]);
    const active = list.filter((reminder) =>
      reminder.kind === 'daily'
        ? reminder.completedAt === null
        : reminder.kind === 'once'
          ? reminder.date >= yesterday
          : true,
    );
    return { reminders: active, completions, settings };
  }

  async getSettings(): Promise<ReminderSettings> {
    const [row] = await this.db
      .select()
      .from(reminderSettings)
      .where(eq(reminderSettings.userId, this.userId));
    return row
      ? { repeatEnabled: row.repeatEnabled, repeatTimes: normalizeTimes(row.repeatTimes) }
      : DEFAULT_REMINDER_SETTINGS;
  }

  async saveSettings(settings: ReminderSettings): Promise<void> {
    const values = {
      repeatEnabled: settings.repeatEnabled,
      repeatTimes: normalizeTimes(settings.repeatTimes),
    };
    await this.db
      .insert(reminderSettings)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: reminderSettings.userId, set: values });
  }

  async saveReminder(input: ReminderInput): Promise<void> {
    const values = columnsFor(input);
    const [{ others }] = await this.db
      .select({ others: sql<number>`count(*) filter (where ${reminders.id} <> ${input.id})`.mapWith(Number) })
      .from(reminders)
      .where(eq(reminders.userId, this.userId));
    checkQuota(others, QUOTAS.reminders, `Dá para ter até ${QUOTAS.reminders} lembretes.`);
    await this.db
      .insert(reminders)
      .values({ userId: this.userId, id: input.id, ...values })
      .onConflictDoUpdate({ target: [reminders.userId, reminders.id], set: values });
  }

  async deleteReminder(id: string): Promise<void> {
    await this.db.delete(reminders).where(and(eq(reminders.userId, this.userId), eq(reminders.id, id)));
  }

  async setDone(id: string, dueDate: string, done: boolean, now: Date = new Date()): Promise<void> {
    const reminder = await this.findReminder(id);
    if (!reminder) throw new HttpError(404, 'NOT_FOUND', 'Esse lembrete não existe mais.');

    if (reminder.kind === 'daily') {
      await this.db
        .update(reminders)
        .set({ completedAt: done ? now : null })
        .where(and(eq(reminders.userId, this.userId), eq(reminders.id, id)));
      return;
    }

    if (!done) {
      await this.db
        .delete(reminderCompletions)
        .where(
          and(
            eq(reminderCompletions.userId, this.userId),
            eq(reminderCompletions.reminderId, id),
            eq(reminderCompletions.dueDate, dueDate),
          ),
        );
      return;
    }

    if (!isDueOn(reminder, dueDate)) {
      throw new HttpError(400, 'NOT_DUE', 'Esse lembrete não vence nesse dia.');
    }
    // Done today also settles the earlier days still owed ("atrasado desde …").
    const already = new Set(
      (await this.listCompletions(addDays(dueDate, -REMINDER_LOOKBACK_DAYS)))
        .filter((completion) => completion.reminderId === id)
        .map((completion) => completion.dueDate),
    );
    const days = new Set([...pendingDueDates(reminder, already, dueDate), dueDate]);
    await this.db
      .insert(reminderCompletions)
      .values([...days].map((day) => ({ userId: this.userId, reminderId: id, dueDate: day, doneAt: now })))
      .onConflictDoNothing();
  }

  private async findReminder(id: string): Promise<Reminder | null> {
    const [row] = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.userId, this.userId), eq(reminders.id, id)));
    return row ? toReminder(row) : null;
  }

  private async listReminders(): Promise<Reminder[]> {
    const rows = await this.db
      .select()
      .from(reminders)
      .where(eq(reminders.userId, this.userId))
      .orderBy(reminders.createdAt);
    return rows.map(toReminder);
  }

  private async listCompletions(since: string): Promise<ReminderCompletion[]> {
    const rows = await this.db
      .select({ reminderId: reminderCompletions.reminderId, dueDate: reminderCompletions.dueDate })
      .from(reminderCompletions)
      .where(and(eq(reminderCompletions.userId, this.userId), gte(reminderCompletions.dueDate, since)));
    return rows;
  }
}
