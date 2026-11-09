'use client';

import { CalendarClock, CalendarDays, CalendarRange, Check, ListChecks, type LucideIcon } from 'lucide-react';
import type { IconTone } from '@/components/ui/IconTile';
import {
  formatDayMonth,
  formatTimes,
  scheduleSummary,
  type DailyTask,
  type ReminderItem,
  type ReminderKind,
} from '@/lib/reminders';

export const KIND_STYLE: Record<ReminderKind, { icon: LucideIcon; tone: IconTone; label: string }> = {
  once: { icon: CalendarClock, tone: 'orange', label: 'Compromissos' },
  daily: { icon: ListChecks, tone: 'green', label: 'Tarefas do dia' },
  weekly: { icon: CalendarDays, tone: 'blue', label: 'Toda semana' },
  monthly: { icon: CalendarRange, tone: 'purple', label: 'Todo mês' },
};

/** The round "Realizado" button: empty until done, filled with a check after. */
export function DoneButton({
  done,
  label,
  onToggle,
  disabled,
}: {
  done: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={done}
      aria-label={done ? `Desmarcar "${label}"` : `Marcar "${label}" como feito`}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
          done
            ? 'border-success-fill bg-success-fill text-white'
            : 'border-border hover:border-success-fill text-transparent'
        }`}
      >
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
      </span>
    </button>
  );
}

/** A reminder due on a day: its time, the text, when it repeats, and the done button. */
export function DueRow({
  item,
  showTime = true,
  busy,
  onToggle,
  onOpen,
}: {
  item: ReminderItem;
  showTime?: boolean;
  busy?: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
}) {
  const { reminder } = item;
  const time = reminder.kind === 'daily' ? reminder.times[0] : reminder.time;
  return (
    <li className="border-border bg-card flex items-center gap-3 rounded-xl border py-2 pr-1 pl-3 shadow-sm">
      {showTime && (
        <span
          className={`bg-background shrink-0 rounded-lg px-2 py-1 text-sm font-semibold tabular-nums ${
            item.done ? 'text-muted' : 'text-foreground'
          }`}
        >
          {time}
        </span>
      )}
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-1 text-left" disabled={!onOpen}>
        <span
          className={`block truncate font-medium ${item.done ? 'text-muted line-through' : 'text-foreground'}`}
        >
          {reminder.message}
        </span>
        <span className="text-muted block truncate text-xs">
          {item.overdueSince && !item.done ? (
            <span className="text-danger font-medium">Atrasado desde {formatDayMonth(item.overdueSince)} · </span>
          ) : null}
          {scheduleSummary(reminder)}
        </span>
      </button>
      {onToggle && <DoneButton done={item.done} label={reminder.message} onToggle={onToggle} disabled={busy} />}
    </li>
  );
}

/** A daily task in the checklist. */
export function TaskRow({
  task,
  done,
  busy,
  onToggle,
  onOpen,
}: {
  task: DailyTask;
  done: boolean;
  busy?: boolean;
  onToggle: () => void;
  onOpen?: () => void;
}) {
  return (
    <li className="border-border bg-card flex items-center gap-1 rounded-xl border py-2 pr-3 pl-1 shadow-sm">
      <DoneButton done={done} label={task.message} onToggle={onToggle} disabled={busy} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-1 text-left" disabled={!onOpen}>
        <span className={`block truncate font-medium ${done ? 'text-muted line-through' : 'text-foreground'}`}>
          {task.message}
        </span>
        <span className="text-muted block truncate text-xs">
          {done ? 'Concluída hoje' : `Avisa às ${formatTimes(task.times)}`}
        </span>
      </button>
    </li>
  );
}
