'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { useReminders } from '@/components/reminders/RemindersProvider';
import { IconTile } from '@/components/ui/IconTile';
import {
  WEEKDAY_LETTERS,
  addDays,
  datesBetween,
  formatDayMonth,
  weekdayOf,
  type ISODate,
  type OnceReminder,
} from '@/lib/reminders';

/** Today and the 30 days after it. */
const DAYS_AHEAD = 30;
const MAX_LISTED = 3;
const CALENDAR = '/lembretes?aba=calendario';

/** "nov" — over the 1st of a month, so the turn of the month is never a surprise. */
function monthShort(date: ISODate): string {
  return new Date(`${date}T12:00:00Z`)
    .toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' })
    .replace('.', '');
}

/**
 * Início widget of Lembretes: today and the next 30 days at a glance, with the days that have a
 * compromisso marked. Any tap opens Lembretes straight on the Calendário tab — on a marked day,
 * already showing what is on it.
 */
export function CalendarHomeCard() {
  const { snapshot, error } = useReminders();
  const router = useRouter();

  const frame = 'border-border bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm';
  const header = (subtitle: string | null) => (
    <Link href={CALENDAR} className="flex items-center gap-3">
      <IconTile icon={CalendarDays} tone="blue" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground font-semibold">Calendário</p>
        {subtitle === null ? (
          <span aria-hidden className="bg-border mt-1 block h-3 w-40 animate-pulse rounded" />
        ) : (
          <p className="text-muted truncate text-xs">{subtitle}</p>
        )}
      </div>
      <ChevronRight className="text-muted h-4 w-4" aria-hidden />
    </Link>
  );

  if (!snapshot) {
    return (
      <section className={frame} aria-label="Calendário dos próximos 30 dias" data-tour="card-calendar">
        {header(error ? 'Hoje e os próximos 30 dias' : null)}
        {error && <p className="text-danger text-sm">{error}</p>}
      </section>
    );
  }

  const { today } = snapshot;
  const last = addDays(today, DAYS_AHEAD);
  const days = datesBetween(today, last);
  const appointments = snapshot.reminders
    .filter(
      (reminder): reminder is OnceReminder =>
        reminder.kind === 'once' && reminder.date >= today && reminder.date <= last,
    )
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const busy = new Set(appointments.map((reminder) => reminder.date));
  const done = new Set(snapshot.completions.map((c) => `${c.reminderId}:${c.dueDate}`));
  const upcoming = appointments.filter((reminder) => !done.has(`${reminder.id}:${reminder.date}`));
  const open = (date?: ISODate) => router.push(date ? `${CALENDAR}&dia=${date}` : CALENDAR);

  return (
    <section className={frame} aria-label="Calendário dos próximos 30 dias" data-tour="card-calendar">
      {header(
        appointments.length === 0
          ? 'Nada marcado nos próximos 30 dias'
          : `${appointments.length} ${appointments.length === 1 ? 'compromisso' : 'compromissos'} nos próximos 30 dias`,
      )}

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LETTERS.map((letter, index) => (
          <span key={index} className="text-muted text-[11px] font-semibold">
            {letter}
          </span>
        ))}
        {Array.from({ length: weekdayOf(today) }, (_, index) => (
          <span key={`antes-${index}`} />
        ))}
        {days.map((date) => {
          const isToday = date === today;
          const marked = busy.has(date);
          const firstOfMonth = date.endsWith('-01');
          return (
            <span key={date} className="flex flex-col items-center">
              <span aria-hidden className="text-primary h-3 text-[9px] leading-3 font-semibold uppercase">
                {firstOfMonth ? monthShort(date) : ''}
              </span>
              <button
                type="button"
                onClick={() => open(marked ? date : undefined)}
                aria-label={
                  marked
                    ? `Ver os compromissos de ${formatDayMonth(date)}`
                    : `Abrir o calendário em ${formatDayMonth(date)}`
                }
                className={`relative flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                  isToday && marked
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : isToday
                      ? 'ring-primary text-foreground font-semibold ring-2'
                      : marked
                        ? 'bg-series-2/20 text-foreground font-semibold'
                        : 'text-foreground'
                }`}
              >
                {Number(date.slice(8))}
                {marked && !isToday && (
                  <span aria-hidden className="bg-series-2 absolute bottom-0.5 h-1 w-1 rounded-full" />
                )}
              </button>
            </span>
          );
        })}
      </div>

      {upcoming.length > 0 && (
        <ul className="border-border flex flex-col gap-1 border-t pt-3">
          {upcoming.slice(0, MAX_LISTED).map((reminder) => (
            <li key={reminder.id}>
              <button
                type="button"
                onClick={() => open(reminder.date)}
                className="flex min-h-[36px] w-full items-center gap-3 text-left"
              >
                <span className="text-foreground w-12 shrink-0 text-sm font-semibold tabular-nums">
                  {formatDayMonth(reminder.date)}
                </span>
                <span className="text-muted w-11 shrink-0 text-xs tabular-nums">{reminder.time}</span>
                <span className="text-foreground min-w-0 flex-1 truncate text-sm">{reminder.message}</span>
              </button>
            </li>
          ))}
          {upcoming.length > MAX_LISTED && (
            <li>
              <Link href={CALENDAR} className="text-primary text-sm font-semibold">
                Ver todos os {upcoming.length}
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
