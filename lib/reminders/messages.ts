import { greetingAtHour } from '../budget/greeting';
import type { NotificationSlot } from './schedule';
import { formatDayMonth, formatFullDate, timeToMinutes } from './time';
import type { Reminder } from './types';

/** One notification to send, before the server attaches the signed "Realizado" button. */
export interface PlannedNotification {
  title: string;
  body: string;
  url: string;
  /** Same tag replaces the previous one: the 12:00 reminder takes the place of the 08:00 one. */
  tag: string;
  /** What "Realizado ✅" completes; absent when the notification groups several tasks. */
  done: { reminderId: string; dueDate: string } | null;
  /** Every slot this notification covers — all of them are recorded as delivered. */
  slots: NotificationSlot[];
}

const REMINDERS_URL = '/lembretes';
const TASKS_SHOWN = 5;

/** "Bom dia, Enzo ☀️" — the person's first name when the account has one, "Bom dia ☀️" otherwise. */
function greeting(slot: NotificationSlot, name: string | null): string {
  const { text, emoji } = greetingAtHour(Math.floor(timeToMinutes(slot.time) / 60));
  return `${text}${name ? `, ${name}` : ''} ${emoji}`;
}

function advanceText(minutes: number, reminder: Reminder & { kind: 'once' }): string {
  if (minutes === 1440) return `Amanhã às ${reminder.time}.`;
  if (minutes === 60) return `Daqui a 1 hora, às ${reminder.time}.`;
  if (minutes < 60) return `Daqui a ${minutes} minutos, às ${reminder.time}.`;
  return `${formatFullDate(reminder.date)} às ${reminder.time}.`;
}

/** "Enzo, amanhã às 09:00." */
function addressed(text: string, name: string | null): string {
  return name ? `${name}, ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function reminderBody(
  reminder: Exclude<Reminder, { kind: 'daily' }>,
  slot: NotificationSlot,
  name: string | null,
): string {
  const hello = greeting(slot, name);
  const late = slot.overdueSince ? ` Atrasado desde ${formatDayMonth(slot.overdueSince)}.` : '';
  switch (slot.kind) {
    case 'advance':
      return reminder.kind === 'once' && reminder.notifyBeforeMinutes
        ? addressed(advanceText(reminder.notifyBeforeMinutes, reminder), name)
        : `${hello}! É às ${reminder.time}.`;
    case 'due':
      return `${hello}! É para hoje, às ${reminder.time}.${late}`;
    default:
      return slot.dueDate === slot.date
        ? `${hello}! Ainda não foi marcado como feito (era às ${reminder.time}).`
        : `${hello}!${late}`;
  }
}

/**
 * Turns the slots of one user into notifications: one per reminder (the latest slot, when a
 * catch-up found several) and one for all the daily tasks together — a notification per task
 * would be spam. `name` is the person's first name, when the account has one: the reminders
 * call them by it.
 */
export function planNotifications(
  slots: NotificationSlot[],
  reminders: Reminder[],
  name: string | null = null,
): PlannedNotification[] {
  const byId = new Map(reminders.map((reminder) => [reminder.id, reminder]));
  const perReminder = new Map<string, NotificationSlot[]>();
  const taskSlots: NotificationSlot[] = [];

  for (const slot of slots) {
    const reminder = byId.get(slot.reminderId);
    if (!reminder) continue;
    if (reminder.kind === 'daily') {
      taskSlots.push(slot);
    } else {
      perReminder.set(slot.reminderId, [...(perReminder.get(slot.reminderId) ?? []), slot]);
    }
  }

  const planned: PlannedNotification[] = [];

  for (const [reminderId, covered] of perReminder) {
    const reminder = byId.get(reminderId) as Exclude<Reminder, { kind: 'daily' }>;
    const latest = covered[covered.length - 1];
    planned.push({
      title: `${latest.kind === 'advance' ? '📌' : '🔔'} ${reminder.message}`,
      body: reminderBody(reminder, latest, name),
      url: REMINDERS_URL,
      tag: `lembrete-${reminderId}`,
      done: { reminderId, dueDate: latest.dueDate },
      slots: covered,
    });
  }

  if (taskSlots.length > 0) {
    const latest = taskSlots[taskSlots.length - 1];
    const tasks = [...new Set(taskSlots.map((slot) => slot.reminderId))].map(
      (id) => byId.get(id) as Reminder,
    );
    if (tasks.length === 1) {
      planned.push({
        title: `📋 ${tasks[0].message}`,
        body: `${greeting(latest, name)}! Tarefa de hoje.`,
        url: REMINDERS_URL,
        tag: 'tarefas',
        done: { reminderId: tasks[0].id, dueDate: latest.date },
        slots: taskSlots,
      });
    } else {
      const lines = tasks.slice(0, TASKS_SHOWN).map((task) => `• ${task.message}`);
      if (tasks.length > TASKS_SHOWN) lines.push(`+ ${tasks.length - TASKS_SHOWN} tarefas`);
      planned.push({
        title: `📋 ${name ? `${name}, ` : ''}${tasks.length} tarefas para hoje`,
        body: lines.join('\n'),
        url: REMINDERS_URL,
        tag: 'tarefas',
        done: null,
        slots: taskSlots,
      });
    }
  }

  return planned;
}
