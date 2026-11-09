'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui/Chip';
import { Switch } from '@/components/ui/Switch';
import { createId } from '@/lib/budget';
import {
  NOTIFY_BEFORE_OPTIONS,
  WEEKDAY_LETTERS,
  WEEKDAY_SHORT,
  normalizeTimes,
  notifyBeforeLabel,
  scheduleSummary,
  weekdayOf,
  type ISODate,
  type Reminder,
  type ReminderInput,
  type ReminderKind,
  type TimeOfDay,
} from '@/lib/reminders';

const KIND_OPTIONS: { kind: ReminderKind; label: string; hint: string }[] = [
  { kind: 'once', label: 'Uma vez', hint: 'Um compromisso com data e hora.' },
  {
    kind: 'daily',
    label: 'Tarefa do dia',
    hint: 'Todo dia, nos horários que escolher, até concluir.',
  },
  { kind: 'weekly', label: 'Toda semana', hint: 'Nos dias da semana que você marcar.' },
  { kind: 'monthly', label: 'Todo mês', hint: 'Sempre no mesmo dia do mês.' },
];

const DEFAULT_TIME = '09:00';

const inputClass =
  'border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2';

/**
 * Create or edit a reminder. Every field that decides when it notifies is the user's choice —
 * nothing here assumes anyone's routine.
 */
export function ReminderFormSheet({
  initial,
  initialDate,
  today,
  repeatEnabled,
  onClose,
  onSave,
  onDelete,
}: {
  initial?: Reminder;
  /** The day a new reminder starts on — a day tapped in the calendar. Defaults to today. */
  initialDate?: ISODate;
  today: ISODate;
  /** The user's master switch for reminding again (Configurações). */
  repeatEnabled: boolean;
  onClose: () => void;
  onSave: (reminder: ReminderInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [kind, setKind] = useState<ReminderKind>(initial?.kind ?? 'once');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [date, setDate] = useState<ISODate>(
    initial?.kind === 'once' ? initial.date : (initialDate ?? today),
  );
  const [time, setTime] = useState<TimeOfDay>(
    initial && initial.kind !== 'daily' ? initial.time : DEFAULT_TIME,
  );
  const [times, setTimes] = useState<TimeOfDay[]>(
    initial?.kind === 'daily' ? initial.times : [DEFAULT_TIME],
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    initial?.kind === 'weekly' ? initial.weekdays : [weekdayOf(initialDate ?? today)],
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    String(
      initial?.kind === 'monthly' ? initial.dayOfMonth : Number((initialDate ?? today).slice(8, 10)),
    ),
  );
  const [notifyBefore, setNotifyBefore] = useState<number | null>(
    initial?.kind === 'once' ? initial.notifyBeforeMinutes : null,
  );
  const [repeat, setRepeat] = useState(initial?.repeat ?? true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function draft(): ReminderInput {
    const base = { id: initial?.id ?? createId(), message: message.trim(), repeat };
    switch (kind) {
      case 'once':
        return { ...base, kind, date, time, notifyBeforeMinutes: notifyBefore };
      case 'daily':
        return { ...base, kind, times: normalizeTimes(times) };
      case 'weekly':
        return { ...base, kind, weekdays: [...weekdays].sort(), time };
      case 'monthly':
        return { ...base, kind, dayOfMonth: Number(dayOfMonth), time };
    }
  }

  function problems(reminder: ReminderInput): string[] {
    const list: string[] = [];
    if (!reminder.message) list.push('Escreva o que é para lembrar.');
    if (reminder.kind === 'once') {
      if (!reminder.date) list.push('Escolha a data.');
      else if (reminder.date < today && !initial) list.push('A data já passou.');
    }
    if (reminder.kind !== 'daily' && !reminder.time) list.push('Escolha o horário.');
    if (reminder.kind === 'daily' && reminder.times.length === 0) list.push('Escolha pelo menos um horário.');
    if (reminder.kind === 'weekly' && reminder.weekdays.length === 0) {
      list.push('Marque pelo menos um dia da semana.');
    }
    if (
      reminder.kind === 'monthly' &&
      !(Number.isInteger(reminder.dayOfMonth) && reminder.dayOfMonth >= 1 && reminder.dayOfMonth <= 31)
    ) {
      list.push('O dia do mês vai de 1 a 31.');
    }
    return list;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const reminder = draft();
    const found = problems(reminder);
    setErrors(found);
    if (found.length > 0) return;
    setSaving(true);
    try {
      await onSave(reminder);
    } finally {
      setSaving(false);
    }
  }

  const current = draft();
  const complete = problems(current).length === 0;
  const kindHint = KIND_OPTIONS.find((option) => option.kind === kind)?.hint;

  return (
    <BottomSheet open title={initial ? 'Editar lembrete' : 'Novo lembrete'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          O que lembrar
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ex.: Pagar a conta de luz"
            maxLength={300}
            autoFocus={!initial}
            className={inputClass}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-muted text-sm font-medium">Quando</span>
          <div className="flex flex-wrap gap-2">
            {KIND_OPTIONS.map((option) => (
              <Chip
                key={option.kind}
                label={option.label}
                selected={kind === option.kind}
                onClick={() => setKind(option.kind)}
              />
            ))}
          </div>
          {kindHint && <p className="text-muted text-xs">{kindHint}</p>}
        </div>

        {kind === 'once' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
                Data
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </label>
              <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
                Hora
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
              </label>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-muted text-sm font-medium">Avisar antes também</span>
              <div className="flex flex-wrap gap-2">
                <Chip label="Não" selected={notifyBefore === null} onClick={() => setNotifyBefore(null)} />
                {NOTIFY_BEFORE_OPTIONS.map((minutes) => (
                  <Chip
                    key={minutes}
                    label={notifyBeforeLabel(minutes)}
                    selected={notifyBefore === minutes}
                    onClick={() => setNotifyBefore(minutes)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {kind === 'daily' && (
          <div className="flex flex-col gap-2">
            <span className="text-muted text-sm font-medium">Horários do aviso</span>
            <div className="flex flex-col gap-2">
              {times.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={value}
                    aria-label={`Horário ${index + 1}`}
                    onChange={(e) =>
                      setTimes((list) => list.map((item, i) => (i === index ? e.target.value : item)))
                    }
                    className={`${inputClass} flex-1`}
                  />
                  {times.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setTimes((list) => list.filter((_, i) => i !== index))}
                      aria-label={`Tirar o horário ${value}`}
                      className="text-muted hover:text-danger flex h-11 w-11 items-center justify-center rounded-lg"
                    >
                      <X className="h-5 w-5" aria-hidden />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {times.length < 12 && (
              <button
                type="button"
                onClick={() => setTimes((list) => [...list, list[list.length - 1] ?? DEFAULT_TIME])}
                className="text-primary flex min-h-[44px] items-center gap-1 self-start text-sm font-semibold"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Adicionar horário
              </button>
            )}
          </div>
        )}

        {kind === 'weekly' && (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-muted text-sm font-medium">Dias da semana</span>
              <div className="flex justify-between gap-1">
                {WEEKDAY_LETTERS.map((letter, day) => {
                  const on = weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={WEEKDAY_SHORT[day]}
                      onClick={() =>
                        setWeekdays((list) => (on ? list.filter((d) => d !== day) : [...list, day]))
                      }
                      className={`flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold ${
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-foreground'
                      }`}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
              Hora
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
            </label>
          </>
        )}

        {kind === 'monthly' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
              Dia do mês
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
              Hora
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
            </label>
          </div>
        )}

        {kind !== 'daily' && (
          <div className="border-border flex items-start gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-medium">Lembrar de novo até eu marcar feito</p>
              <p className="text-muted mt-0.5 text-xs">
                {repeatEnabled
                  ? 'Avisa de novo nos seus horários de repetição.'
                  : 'A repetição está desligada em Configurações → Lembretes.'}
              </p>
            </div>
            <Switch checked={repeat} onChange={setRepeat} label="Lembrar de novo até eu marcar feito" />
          </div>
        )}

        {complete && (
          <p className="bg-background text-foreground rounded-lg px-3 py-2 text-sm">
            <span className="text-muted">Resumo: </span>
            {scheduleSummary(current)}
          </p>
        )}

        {errors.length > 0 && (
          <ul className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">
            {errors.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-3 pt-1">
          {onDelete && (
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={saving}
              className="border-danger text-danger min-h-[44px] rounded-lg border px-4 py-2 font-medium disabled:opacity-50"
            >
              Excluir
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
