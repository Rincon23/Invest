import { formatFullDate } from './time';
import type { Reminder, ReminderInput, TimeOfDay } from './types';

export const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** For the weekday toggles: D S T Q Q S S. */
export const WEEKDAY_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** "a", "a e b", "a, b e c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export function formatTimes(times: TimeOfDay[]): string {
  return joinList(times);
}

export function notifyBeforeLabel(minutes: number): string {
  if (minutes === 1440) return '1 dia antes';
  if (minutes === 60) return '1 hora antes';
  return `${minutes} min antes`;
}

/** One line describing when a reminder happens, for the lists. */
export function scheduleSummary(reminder: Reminder | ReminderInput): string {
  switch (reminder.kind) {
    case 'once': {
      const notice = reminder.notifyBeforeMinutes
        ? ` · avisa ${notifyBeforeLabel(reminder.notifyBeforeMinutes)}`
        : '';
      return `${formatFullDate(reminder.date)} às ${reminder.time}${notice}`;
    }
    case 'daily':
      return `Todo dia às ${formatTimes(reminder.times)}, até concluir`;
    case 'weekly': {
      const days = [...reminder.weekdays].sort();
      if (days.length === 7) return `Todo dia às ${reminder.time}`;
      if (days.join() === '1,2,3,4,5') return `Dias úteis às ${reminder.time}`;
      if (days.join() === '0,6') return `Fins de semana às ${reminder.time}`;
      return `Toda ${joinList(days.map((day) => WEEKDAY_SHORT[day]))} às ${reminder.time}`;
    }
    case 'monthly': {
      const last = reminder.dayOfMonth >= 29 ? ' (ou o último dia do mês)' : '';
      return `Todo dia ${reminder.dayOfMonth} às ${reminder.time}${last}`;
    }
  }
}
