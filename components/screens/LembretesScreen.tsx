'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Clock } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { NotificationsHint } from '@/components/pwa/NotificationsHint';
import { DueRow, KIND_STYLE, TaskRow } from '@/components/reminders/ReminderRows';
import { ReminderFormSheet } from '@/components/reminders/ReminderFormSheet';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useReminders } from '@/components/reminders/RemindersProvider';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { IconTile } from '@/components/ui/IconTile';
import { useToast } from '@/components/ui/Toast';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton, ModuleSettingsButton } from '@/components/modules/ModuleHelpButton';
import { ModuleSettingsSheet } from '@/components/modules/ModuleSettingsSheet';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useModuleIntro } from '@/components/modules/useModuleIntro';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { ReminderSettingsSection } from '@/components/settings/ReminderSettingsSection';
import { useMissions } from '@/components/missions/MissionsProvider';
import { formatMonthLabel, nextMonth } from '@/lib/budget';
import {
  WEEKDAY_LETTERS,
  daysInMonth,
  formatDayMonth,
  notifyBeforeLabel,
  reminderDay,
  scheduleSummary,
  weekdayOf,
  zonedMoment,
  type ISODate,
  type OnceReminder,
  type Reminder,
  type ReminderKind,
} from '@/lib/reminders';
import { remindersRepository, type RemindersSnapshot } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';

export type LembretesTab = 'hoje' | 'todos' | 'calendario';
type Tab = LembretesTab;

const TABS: { key: Tab; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'todos', label: 'Todos' },
  { key: 'calendario', label: 'Calendário' },
];

export function LembretesScreen({
  initialTab,
  initialDay,
}: {
  initialTab?: LembretesTab;
  initialDay?: ISODate;
}) {
  return (
    <ModuleGate module="reminders">
      <Lembretes initialTab={initialTab} initialDay={initialDay} />
    </ModuleGate>
  );
}

/** "Quarta-feira, 16 de setembro" */
function longDate(date: ISODate): string {
  const text = new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Lembretes({ initialTab, initialDay }: { initialTab?: LembretesTab; initialDay?: ISODate }) {
  const backHref = useHomeHref();
  const { snapshot, loading, error, run, refresh } = useReminders();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'hoje');

  // A link to "?aba=…" while the screen is already open (the Calendário widget) switches the tab.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialTab) setTab(initialTab);
  }, [initialTab, initialDay]);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [creating, setCreating] = useState(false);
  /** The day a new reminder starts on, when it came from tapping a free day in the calendar. */
  const [creatingDate, setCreatingDate] = useState<ISODate | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  useModuleIntro('reminders', { ready: !!snapshot });

  // "Conferir o calendário", of the Missões: done by opening the tab.
  const { visit } = useMissions();
  useEffect(() => {
    if (tab === 'calendario') visit('check-calendar');
  }, [tab, visit]);

  if (loading && !snapshot) {
    return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
  }
  if (!snapshot) {
    return <p className="bg-danger-bg text-danger m-4 rounded-lg px-3 py-2 text-sm">{error}</p>;
  }

  async function toggleDone(reminder: Reminder, dueDate: ISODate, done: boolean) {
    setBusyId(reminder.id);
    try {
      await run(() => remindersRepository.setDone(reminder.id, dueDate, done));
      if (done) {
        showToast(reminder.kind === 'daily' ? 'Tarefa concluída e arquivada.' : 'Marcado como feito.');
      } else {
        showToast('Desmarcado.', 'info');
      }
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível salvar. Tente de novo.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(reminder: Reminder) {
    const confirmed = await confirm({
      title: 'Excluir lembrete',
      message: `Excluir "${reminder.message}"? Ele para de avisar e sai do histórico.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) {
      showToast('Operação cancelada. Nenhuma alteração foi realizada.', 'info');
      return;
    }
    await run(() => remindersRepository.deleteReminder(reminder.id));
    setEditing(null);
    showToast('Lembrete excluído.');
  }

  const actions = {
    busyId,
    open: (reminder: Reminder) => setEditing(reminder),
    toggle: (reminder: Reminder, dueDate: ISODate, done: boolean) => void toggleDone(reminder, dueDate, done),
  };

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      <PageHeader
        title="Lembretes"
        subtitle={longDate(snapshot.today)}
        backHref={backHref}
        action={
          <>
            <ModuleHelpButton module="reminders" />
            <ModuleSettingsButton
              module="reminders"
              tourAnchor="lembretes-config"
              onClick={() => setConfiguring(true)}
            />
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="Novo lembrete"
              data-tour="lembretes-novo"
              className="bg-primary text-primary-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl"
            >
              +
            </button>
          </>
        }
      />

      <div className="px-4" data-tour="lembretes-abas">
        <div role="tablist" className="bg-card border-border grid grid-cols-3 gap-1 rounded-xl border p-1">
          {TABS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              onClick={() => setTab(option.key)}
              className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                tab === option.key ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="bg-danger-bg text-danger mx-4 rounded-lg px-3 py-2 text-sm">{error}</p>}

      {tab === 'hoje' && (
        <TodayView
          snapshot={snapshot}
          actions={actions}
          onCreate={() => setCreating(true)}
          onActivateNotifications={() => setConfiguring(true)}
        />
      )}
      {tab === 'todos' && (
        <AllView snapshot={snapshot} onOpen={actions.open} onCreate={() => setCreating(true)} />
      )}
      {tab === 'calendario' && (
        <CalendarView
          key={initialDay}
          snapshot={snapshot}
          initialDay={initialDay}
          onOpen={actions.open}
          onCreate={(date) => {
            setCreatingDate(date);
            setCreating(true);
          }}
        />
      )}

      {configuring && (
        <ModuleSettingsSheet
          module="reminders"
          onClose={() => {
            setConfiguring(false);
            // The repeat setting shows up in the reminder form.
            void refresh();
          }}
        >
          <NotificationsSection />
          <ReminderSettingsSection />
        </ModuleSettingsSheet>
      )}

      {(creating || editing) && (
        <ReminderFormSheet
          initial={editing ?? undefined}
          initialDate={creatingDate}
          today={snapshot.today}
          repeatEnabled={snapshot.settings.repeatEnabled}
          onClose={() => {
            setCreating(false);
            setCreatingDate(undefined);
            setEditing(null);
          }}
          onSave={async (reminder) => {
            try {
              await run(() => remindersRepository.saveReminder(reminder));
              showToast(editing ? 'Lembrete atualizado.' : 'Lembrete criado.');
              setCreating(false);
              setCreatingDate(undefined);
              setEditing(null);
            } catch (err) {
              showToast(toStorageErrorMessage(err, 'Não foi possível salvar. Tente de novo.'), 'error');
            }
          }}
          onDelete={editing ? () => handleDelete(editing) : undefined}
        />
      )}
    </div>
  );
}

interface RowActions {
  busyId: string | null;
  open: (reminder: Reminder) => void;
  toggle: (reminder: Reminder, dueDate: ISODate, done: boolean) => void;
}

function Section({ title, tone, children }: { title: string; tone?: 'danger'; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 px-4">
      <h2 className={`text-sm font-semibold ${tone === 'danger' ? 'text-danger' : 'text-muted'}`}>{title}</h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function TodayView({
  snapshot,
  actions,
  onCreate,
  onActivateNotifications,
}: {
  snapshot: RemindersSnapshot;
  actions: RowActions;
  onCreate: () => void;
  onActivateNotifications: () => void;
}) {
  const day = reminderDay(snapshot.reminders, snapshot.completions, snapshot.today);
  const nothingToday = day.overdue.length === 0 && day.today.length === 0 && day.tasks.length === 0;
  // The number of the screen: what is still to do today (the late ones included), out of all of it.
  const total = day.overdue.length + day.today.length + day.tasks.length;
  const pending =
    day.overdue.length +
    day.today.filter((item) => !item.done).length +
    day.tasks.filter((item) => !item.done).length;

  return (
    <>
      <NotificationsHint onActivate={onActivateNotifications} />

      {!nothingToday && (
        <section
          data-tour="lembretes-resumo"
          className="border-border bg-card mx-4 flex flex-col gap-2 rounded-2xl border p-4 shadow-sm"
        >
          {pending === 0 ? (
            <>
              <p className="text-muted text-sm">Hoje</p>
              <p className="text-success text-2xl font-bold">Tudo feito ✓</p>
            </>
          ) : (
            <>
              <p className="text-muted text-sm">Falta fazer hoje</p>
              <p className="text-foreground text-2xl font-bold tabular-nums">
                {pending} {pending === 1 ? 'lembrete' : 'lembretes'}
              </p>
            </>
          )}
          <div className="bg-border h-2.5 overflow-hidden rounded-full" aria-hidden>
            <div
              className={`h-full rounded-full ${pending === 0 ? 'bg-success-fill' : 'bg-primary'}`}
              style={{ width: `${((total - pending) / total) * 100}%` }}
            />
          </div>
          <p className="text-muted text-sm">
            {total - pending} de {total} {total === 1 ? 'feito' : 'feitos'}
            {day.overdue.length > 0 && (
              <span className="text-danger">
                {' '}
                · {day.overdue.length} {day.overdue.length === 1 ? 'atrasado' : 'atrasados'}
              </span>
            )}
          </p>
        </section>
      )}

      {nothingToday && (
        <div className="border-border bg-card mx-4 flex flex-col items-center gap-2 rounded-2xl border p-6 text-center shadow-sm">
          <IconTile icon={Clock} tone="green" size="lg" />
          <p className="text-foreground font-semibold">Nada para hoje</p>
          <p className="text-muted text-sm">
            {snapshot.reminders.length === 0
              ? 'Crie lembretes e tarefas no horário que quiser.'
              : 'Aproveite o dia. O que vence amanhã aparece logo abaixo.'}
          </p>
          {snapshot.reminders.length === 0 && (
            <button
              type="button"
              onClick={onCreate}
              className="bg-primary text-primary-foreground mt-1 min-h-[44px] rounded-lg px-4 text-sm font-semibold"
            >
              Criar lembrete
            </button>
          )}
        </div>
      )}

      {day.overdue.length > 0 && (
        <Section title="Atrasados" tone="danger">
          {day.overdue.map((item) => (
            <DueRow
              key={item.reminder.id}
              item={item}
              busy={actions.busyId === item.reminder.id}
              onOpen={() => actions.open(item.reminder)}
              onToggle={() => actions.toggle(item.reminder, item.dueDate, true)}
            />
          ))}
        </Section>
      )}

      {day.today.length > 0 && (
        <Section title="Hoje">
          {day.today.map((item) => (
            <DueRow
              key={item.reminder.id}
              item={item}
              busy={actions.busyId === item.reminder.id}
              onOpen={() => actions.open(item.reminder)}
              onToggle={() => actions.toggle(item.reminder, item.dueDate, !item.done)}
            />
          ))}
        </Section>
      )}

      {day.tasks.length > 0 && (
        <Section title="Tarefas do dia">
          {day.tasks.map(({ task, done }) => (
            <TaskRow
              key={task.id}
              task={task}
              done={done}
              busy={actions.busyId === task.id}
              onOpen={() => actions.open(task)}
              onToggle={() => actions.toggle(task, snapshot.today, !done)}
            />
          ))}
        </Section>
      )}

      {day.tomorrow.length > 0 && (
        <Section title="Amanhã">
          {day.tomorrow.map((item) => (
            <DueRow key={item.reminder.id} item={item} onOpen={() => actions.open(item.reminder)} />
          ))}
        </Section>
      )}
    </>
  );
}

const KIND_ORDER: ReminderKind[] = ['daily', 'once', 'weekly', 'monthly'];

function AllView({
  snapshot,
  onOpen,
  onCreate,
}: {
  snapshot: RemindersSnapshot;
  onOpen: (reminder: Reminder) => void;
  onCreate: () => void;
}) {
  const { today } = snapshot;
  const isHistory = (reminder: Reminder) =>
    (reminder.kind === 'daily' && reminder.completedAt !== null) ||
    (reminder.kind === 'once' && reminder.date < today);
  const active = snapshot.reminders.filter((reminder) => !isHistory(reminder));
  const history = snapshot.reminders.filter(isHistory);

  if (snapshot.reminders.length === 0) {
    return (
      <div className="border-border bg-card mx-4 flex flex-col items-center gap-2 rounded-2xl border p-6 text-center shadow-sm">
        <IconTile icon={Clock} tone="neutral" size="lg" />
        <p className="text-foreground font-semibold">Nenhum lembrete ainda</p>
        <button
          type="button"
          onClick={onCreate}
          className="bg-primary text-primary-foreground mt-1 min-h-[44px] rounded-lg px-4 text-sm font-semibold"
        >
          Criar lembrete
        </button>
      </div>
    );
  }

  return (
    <>
      {KIND_ORDER.map((kind) => {
        const items = active
          .filter((reminder) => reminder.kind === kind)
          .sort((a, b) =>
            a.kind === 'once' && b.kind === 'once'
              ? `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
              : a.message.localeCompare(b.message, 'pt-BR'),
          );
        if (items.length === 0) return null;
        const style = KIND_STYLE[kind];
        return (
          <section key={kind} className="flex flex-col gap-2 px-4">
            <h2 className="text-muted flex items-center gap-2 text-sm font-semibold">
              {style.label}
              <span className="text-muted/80 font-normal">· {items.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {items.map((reminder) => (
                <li key={reminder.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(reminder)}
                    className="border-border bg-card hover:border-primary/40 flex w-full items-center gap-3 rounded-xl border p-3 text-left shadow-sm"
                  >
                    <IconTile icon={style.icon} tone={style.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate font-medium">{reminder.message}</span>
                      <span className="text-muted block truncate text-xs">{scheduleSummary(reminder)}</span>
                    </span>
                    <ChevronRight className="text-muted h-4 w-4 shrink-0" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {history.length > 0 && (
        <details className="px-4">
          <summary className="text-muted min-h-[44px] cursor-pointer py-2 text-sm font-semibold">
            Concluídos e passados · {history.length}
          </summary>
          <ul className="flex flex-col gap-2">
            {history.map((reminder) => (
              <li key={reminder.id}>
                <button
                  type="button"
                  onClick={() => onOpen(reminder)}
                  className="border-border bg-card flex w-full flex-col rounded-xl border px-3 py-2 text-left opacity-75"
                >
                  <span className="text-foreground truncate text-sm font-medium">{reminder.message}</span>
                  <span className="text-muted truncate text-xs">
                    {reminder.kind === 'daily' && reminder.completedAt
                      ? `Tarefa concluída em ${formatDayMonth(zonedMoment(new Date(reminder.completedAt)).date)}`
                      : scheduleSummary(reminder)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * The one-off appointments of this month and the next: first both month grids, compact enough to
 * fit on a phone screen together (what matters is spotting what is coming), then the list.
 */
function CalendarView({
  snapshot,
  initialDay,
  onOpen,
  onCreate,
}: {
  snapshot: RemindersSnapshot;
  /** A day to open already showing (a marked day tapped on the Início widget). */
  initialDay?: ISODate;
  onOpen: (reminder: Reminder) => void;
  /** A free day was tapped: the new reminder starts on it. */
  onCreate: (date: ISODate) => void;
}) {
  const current = snapshot.today.slice(0, 7);
  const months = [current, nextMonth(current)];
  const appointments = snapshot.reminders
    .filter(
      (reminder): reminder is OnceReminder =>
        reminder.kind === 'once' && months.includes(reminder.date.slice(0, 7)),
    )
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const busyDays = new Set(appointments.map((reminder) => reminder.date));
  const done = new Set(
    snapshot.completions.map((completion) => `${completion.reminderId}:${completion.dueDate}`),
  );
  const [selectedDay, setSelectedDay] = useState<ISODate | null>(initialDay ?? null);
  const dayAppointments = appointments.filter((reminder) => reminder.date === selectedDay);

  return (
    <>
      {months.map((month) => (
        <MonthGrid
          key={month}
          month={month}
          today={snapshot.today}
          busyDays={busyDays}
          onSelect={setSelectedDay}
          onCreate={onCreate}
        />
      ))}

      <p className="text-muted px-4 text-xs">Toque num dia livre para criar um lembrete já naquela data.</p>

      <section className="flex flex-col gap-2 px-4">
        <h2 className="text-muted text-sm font-semibold">📌 Compromissos</h2>
        {appointments.length === 0 ? (
          <p className="text-muted text-sm">
            Nenhum compromisso em {formatMonthLabel(months[0])} nem em {formatMonthLabel(months[1])}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {appointments.map((reminder) => {
              const finished = done.has(`${reminder.id}:${reminder.date}`);
              const past = reminder.date < snapshot.today;
              return (
                <li key={reminder.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(reminder)}
                    className={`border-border bg-card flex w-full items-center gap-3 rounded-xl border p-3 text-left shadow-sm ${
                      past ? 'opacity-70' : ''
                    }`}
                  >
                    <span className="bg-background flex w-14 shrink-0 flex-col items-center rounded-lg py-1">
                      <span className="text-foreground text-sm font-semibold">
                        {formatDayMonth(reminder.date)}
                      </span>
                      <span className="text-muted text-xs tabular-nums">{reminder.time}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate font-medium ${finished ? 'text-muted line-through' : 'text-foreground'}`}
                      >
                        {reminder.message}
                      </span>
                      <span className="text-muted block text-xs">
                        {finished ? 'Feito' : past ? 'Passou' : longDate(reminder.date)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selectedDay && dayAppointments.length > 0 && (
        <BottomSheet open title={longDate(selectedDay)} onClose={() => setSelectedDay(null)}>
          <ul className="flex flex-col gap-3">
            {dayAppointments.map((reminder) => {
              const finished = done.has(`${reminder.id}:${reminder.date}`);
              const past = reminder.date < snapshot.today;
              return (
                <li key={reminder.id} className="border-border flex flex-col gap-3 rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    <span className="bg-background text-foreground shrink-0 rounded-lg px-2 py-1 text-sm font-semibold tabular-nums">
                      {reminder.time}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`font-medium break-words ${finished ? 'text-muted line-through' : 'text-foreground'}`}
                      >
                        {reminder.message}
                      </p>
                      <p className="text-muted mt-0.5 text-xs">
                        {finished
                          ? 'Feito ✅'
                          : past
                            ? 'Já passou'
                            : reminder.notifyBeforeMinutes
                              ? `Avisa ${notifyBeforeLabel(reminder.notifyBeforeMinutes)} e na hora`
                              : 'Avisa na hora'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDay(null);
                      onOpen(reminder);
                    }}
                    className="border-border text-foreground min-h-[44px] rounded-lg border px-4 text-sm font-medium"
                  >
                    Editar
                  </button>
                </li>
              );
            })}
          </ul>
        </BottomSheet>
      )}
    </>
  );
}

function MonthGrid({
  month,
  today,
  busyDays,
  onSelect,
  onCreate,
}: {
  month: string;
  today: ISODate;
  busyDays: Set<ISODate>;
  /** Called when a day with appointments is tapped. */
  onSelect: (date: ISODate) => void;
  /** Called when a day with nothing on it is tapped: a new reminder, already on that day. */
  onCreate: (date: ISODate) => void;
}) {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = weekdayOf(`${month}-01`);
  const total = daysInMonth(year, monthNumber);
  const cells: (ISODate | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];

  return (
    <section
      aria-label={formatMonthLabel(month)}
      className="border-border bg-card mx-4 flex flex-col gap-1 rounded-2xl border px-3 pt-2 pb-3 shadow-sm"
    >
      <p className="text-foreground text-center text-sm font-semibold">{formatMonthLabel(month)}</p>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAY_LETTERS.map((letter, index) => (
          <span key={index} className="text-muted py-0.5 text-[11px] font-semibold">
            {letter}
          </span>
        ))}
        {cells.map((date, index) => {
          if (!date) return <span key={`vazio-${index}`} />;
          const isToday = date === today;
          const busy = busyDays.has(date);
          // A free day still takes a tap: it opens a new reminder already on that day. Only a
          // day that has already passed does nothing — there is nothing to be reminded of.
          const free = !busy && date >= today;
          const Day = busy || free ? 'button' : 'span';
          return (
            <span key={date} className="flex justify-center">
              <Day
                {...(busy
                  ? {
                      type: 'button' as const,
                      onClick: () => onSelect(date),
                      'aria-label': `Ver os compromissos de ${formatDayMonth(date)}`,
                    }
                  : free
                    ? {
                        type: 'button' as const,
                        onClick: () => onCreate(date),
                        'aria-label': `Criar um lembrete em ${formatDayMonth(date)}`,
                      }
                    : {})}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                  isToday && busy
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : isToday
                      ? 'ring-primary text-foreground font-semibold ring-2'
                      : busy
                        ? 'bg-series-2/20 text-foreground font-semibold'
                        : date < today
                          ? 'text-muted'
                          : 'text-foreground'
                }`}
              >
                {Number(date.slice(8))}
                {busy && !isToday && (
                  <span aria-hidden className="bg-series-2 absolute bottom-0.5 h-1 w-1 rounded-full" />
                )}
              </Day>
            </span>
          );
        })}
      </div>
    </section>
  );
}
