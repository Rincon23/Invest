'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Clock } from 'lucide-react';
import { DueRow, TaskRow } from '@/components/reminders/ReminderRows';
import { useReminders } from '@/components/reminders/RemindersProvider';
import { IconTile } from '@/components/ui/IconTile';
import { useToast } from '@/components/ui/Toast';
import { reminderDay, type ISODate, type Reminder } from '@/lib/reminders';
import { remindersRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';

const MAX_ITEMS = 4;

/**
 * Home screen card: what is still to do today, with the done buttons, for the Lembretes module.
 * It reads the reminders the Início already loaded for it and the calendar (`HomeCardsData`).
 */
export function TodayRemindersCard() {
  const { snapshot, error, run } = useReminders();
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!snapshot) {
    // Same frame as the loaded card, so the dashboard does not jump when it arrives.
    return (
      <section
        className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm"
        aria-label="Lembretes de hoje"
      >
        <div className="flex items-center gap-3">
          <IconTile icon={Clock} tone="amber" />
          <p className="text-foreground font-semibold">Lembretes de hoje</p>
        </div>
        {error ? (
          <p className="text-danger text-sm">{error}</p>
        ) : (
          <span aria-hidden className="bg-border block h-4 w-2/3 animate-pulse rounded" />
        )}
      </section>
    );
  }

  const day = reminderDay(snapshot.reminders, snapshot.completions, snapshot.today);
  const pending = [...day.overdue, ...day.today.filter((item) => !item.done)];
  const tasks = day.tasks.filter((item) => !item.done);
  const total = pending.length + tasks.length;
  const shownPending = pending.slice(0, MAX_ITEMS);
  const shownTasks = tasks.slice(0, Math.max(0, MAX_ITEMS - shownPending.length));

  async function complete(reminder: Reminder, dueDate: ISODate) {
    setBusyId(reminder.id);
    try {
      await run(() => remindersRepository.setDone(reminder.id, dueDate, true));
      showToast(reminder.kind === 'daily' ? 'Tarefa concluída e arquivada.' : 'Marcado como feito.');
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível salvar. Tente de novo.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm"
      aria-label="Lembretes de hoje"
      data-tour="card-reminders"
    >
      <Link href="/lembretes" className="flex items-center gap-3">
        <IconTile icon={Clock} tone={total > 0 ? 'amber' : 'green'} />
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-semibold">Lembretes de hoje</p>
          <p className="text-muted text-xs">
            {total === 0
              ? day.tomorrow.length > 0
                ? `Tudo em dia · ${day.tomorrow.length} para amanhã`
                : 'Tudo em dia'
              : `${total} ${total === 1 ? 'pendente' : 'pendentes'}`}
          </p>
        </div>
        <ChevronRight className="text-muted h-4 w-4" aria-hidden />
      </Link>

      {total > 0 && (
        <ul className="flex flex-col gap-2">
          {shownPending.map((item) => (
            <DueRow
              key={item.reminder.id}
              item={item}
              busy={busyId === item.reminder.id}
              onToggle={() => void complete(item.reminder, item.dueDate)}
            />
          ))}
          {shownTasks.map(({ task }) => (
            <TaskRow
              key={task.id}
              task={task}
              done={false}
              busy={busyId === task.id}
              onToggle={() => void complete(task, snapshot.today)}
            />
          ))}
        </ul>
      )}
      {total > shownPending.length + shownTasks.length && (
        <Link href="/lembretes" className="text-primary text-sm font-semibold">
          Ver todos os {total}
        </Link>
      )}
    </section>
  );
}
