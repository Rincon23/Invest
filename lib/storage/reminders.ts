import type {
  ISODate,
  Reminder,
  ReminderCompletion,
  ReminderInput,
  ReminderSettings,
} from '../reminders/types';
import { apiRequest, seg } from './apiClient';

/** Everything the Lembretes screens need, in one read. */
export interface RemindersSnapshot {
  /** All of them, including done tasks and past appointments (the history). */
  reminders: Reminder[];
  /** Completions of the last two months. */
  completions: ReminderCompletion[];
  settings: ReminderSettings;
  /** "Hoje" in São Paulo, as the server sees it. */
  today: ISODate;
}

/** Like `BudgetRepository`: the screens only talk to this contract. */
export interface RemindersRepository {
  getSnapshot(): Promise<RemindersSnapshot>;
  saveReminder(reminder: ReminderInput): Promise<void>;
  deleteReminder(id: string): Promise<void>;
  /**
   * Marks a due day as done (for weekly/monthly, also the earlier days still owed) or undoes it.
   * For a daily task, completes (archives) it or brings it back.
   */
  setDone(id: string, dueDate: ISODate, done: boolean): Promise<void>;
  saveSettings(settings: ReminderSettings): Promise<void>;
}

export class HttpRemindersRepository implements RemindersRepository {
  getSnapshot(): Promise<RemindersSnapshot> {
    return apiRequest('GET', '/reminders');
  }

  saveReminder(reminder: ReminderInput): Promise<void> {
    return apiRequest('PUT', `/reminders/${seg(reminder.id)}`, reminder);
  }

  deleteReminder(id: string): Promise<void> {
    return apiRequest('DELETE', `/reminders/${seg(id)}`);
  }

  setDone(id: string, dueDate: ISODate, done: boolean): Promise<void> {
    return apiRequest('POST', `/reminders/${seg(id)}/done`, { dueDate, done });
  }

  saveSettings(settings: ReminderSettings): Promise<void> {
    return apiRequest('PUT', '/reminders/settings', settings);
  }
}
