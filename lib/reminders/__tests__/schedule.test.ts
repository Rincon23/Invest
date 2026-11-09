import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_SETTINGS,
  isDueOn,
  notificationSlots,
  pendingDueDates,
  planNotifications,
  reminderDay,
  scheduleSummary,
  zonedInstant,
  zonedMoment,
  type DailyTask,
  type MonthlyReminder,
  type NotificationSlot,
  type OnceReminder,
  type Reminder,
  type ReminderCompletion,
  type ReminderSettings,
  type WeeklyReminder,
} from '..';

/** Relógio falso: tudo acontece em São Paulo, qualquer que seja o fuso da máquina dos testes. */
const at = (date: string, time: string) => zonedInstant(date, time);
const CREATED = '2026-09-01T12:00:00.000Z';

function weekly(overrides: Partial<WeeklyReminder> = {}): WeeklyReminder {
  return {
    id: 'semanal',
    kind: 'weekly',
    message: 'Regar as plantas',
    weekdays: [3], // quarta
    time: '08:00',
    repeat: true,
    // Criado na véspera: nenhuma quarta anterior fica devendo.
    createdAt: '2026-09-15T12:00:00.000Z',
    ...overrides,
  };
}

function monthly(overrides: Partial<MonthlyReminder> = {}): MonthlyReminder {
  return {
    id: 'mensal',
    kind: 'monthly',
    message: 'Pagar a conta de luz',
    dayOfMonth: 10,
    time: '09:00',
    repeat: true,
    createdAt: CREATED,
    ...overrides,
  };
}

function once(overrides: Partial<OnceReminder> = {}): OnceReminder {
  return {
    id: 'pontual',
    kind: 'once',
    message: 'Dentista',
    date: '2026-09-18',
    time: '14:00',
    notifyBeforeMinutes: null,
    repeat: true,
    createdAt: CREATED,
    ...overrides,
  };
}

function task(overrides: Partial<DailyTask> = {}): DailyTask {
  return {
    id: 'tarefa',
    kind: 'daily',
    message: 'Mandar o relatório',
    times: ['08:00', '14:00'],
    repeat: true,
    createdAt: CREATED,
    completedAt: null,
    ...overrides,
  };
}

function slotsFor(
  reminders: Reminder[],
  from: Date,
  to: Date,
  completions: ReminderCompletion[] = [],
  settings: ReminderSettings = DEFAULT_REMINDER_SETTINGS,
) {
  return notificationSlots({ reminders, completions, settings }, from, to);
}

const describeSlot = (slot: NotificationSlot) => `${slot.kind} ${slot.date} ${slot.time}`;

describe('relógio em São Paulo', () => {
  it('converte dia e hora locais para o instante certo', () => {
    expect(at('2026-09-16', '08:00').toISOString()).toBe('2026-09-16T11:00:00.000Z');
    expect(zonedMoment(new Date('2026-09-17T02:30:00.000Z'))).toEqual({
      date: '2026-09-16',
      minutes: 23 * 60 + 30,
    });
  });
});

describe('vencimentos', () => {
  it('mensal no dia 31 cai no último dia dos meses curtos', () => {
    const r = monthly({ dayOfMonth: 31 });
    expect(isDueOn(r, '2026-02-28')).toBe(true);
    expect(isDueOn(r, '2028-02-29')).toBe(true);
    expect(isDueOn(r, '2028-02-28')).toBe(false);
    expect(isDueOn(r, '2026-04-30')).toBe(true);
    expect(isDueOn(r, '2026-03-30')).toBe(false);
    expect(isDueOn(r, '2026-03-31')).toBe(true);
  });

  it('semanal em vários dias da semana', () => {
    const r = weekly({ weekdays: [1, 3, 5] });
    // 14/09/2026 é segunda.
    expect(
      ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].map((d) => isDueOn(r, d)),
    ).toEqual([true, false, true, false, true]);
  });

  it('não cobra nada de antes da criação nem de mais de dois meses atrás', () => {
    const r = monthly({ createdAt: '2026-09-15T12:00:00.000Z' });
    expect(pendingDueDates(r, undefined, '2026-09-16')).toEqual([]);
    expect(
      pendingDueDates(monthly({ createdAt: '2025-01-01T12:00:00.000Z' }), undefined, '2026-09-16'),
    ).toEqual(['2026-08-10', '2026-09-10']);
  });
});

describe('quando notificar', () => {
  it('avisa no horário do lembrete e repete nos horários do usuário até marcar feito', () => {
    const day = slotsFor([weekly()], at('2026-09-16', '00:00'), at('2026-09-16', '23:59'));
    expect(day.map(describeSlot)).toEqual([
      'due 2026-09-16 08:00',
      'repeat 2026-09-16 12:00',
      'repeat 2026-09-16 15:00',
      'repeat 2026-09-16 18:00',
    ]);
  });

  it('cada minuto só vê o que cai nele', () => {
    const r = weekly();
    expect(slotsFor([r], at('2026-09-16', '07:59'), at('2026-09-16', '08:00'))).toHaveLength(1);
    expect(slotsFor([r], at('2026-09-16', '08:00'), at('2026-09-16', '08:01'))).toHaveLength(0);
  });

  it('para de avisar quando é marcado como feito', () => {
    const done = [{ reminderId: 'semanal', dueDate: '2026-09-16' }];
    expect(slotsFor([weekly()], at('2026-09-16', '09:00'), at('2026-09-16', '23:59'), done)).toEqual([]);
  });

  it('continua nos dias seguintes como atrasado', () => {
    const next = slotsFor([weekly()], at('2026-09-17', '00:00'), at('2026-09-17', '23:59'));
    expect(next.map(describeSlot)).toEqual([
      'repeat 2026-09-17 08:00',
      'repeat 2026-09-17 12:00',
      'repeat 2026-09-17 15:00',
      'repeat 2026-09-17 18:00',
    ]);
    expect(next.every((slot) => slot.overdueSince === '2026-09-16')).toBe(true);
  });

  it('respeita os horários e o desligar da repetição', () => {
    const custom = { repeatEnabled: true, repeatTimes: ['07:00', '21:30'] };
    expect(
      slotsFor([weekly()], at('2026-09-16', '00:00'), at('2026-09-16', '23:59'), [], custom).map(
        describeSlot,
      ),
    ).toEqual(['due 2026-09-16 08:00', 'repeat 2026-09-16 21:30']);

    const off = { ...DEFAULT_REMINDER_SETTINGS, repeatEnabled: false };
    expect(slotsFor([weekly()], at('2026-09-16', '00:00'), at('2026-09-16', '23:59'), [], off)).toHaveLength(
      1,
    );
    expect(
      slotsFor([weekly({ repeat: false })], at('2026-09-16', '00:00'), at('2026-09-16', '23:59')),
    ).toHaveLength(1);
  });

  it('mensal atrasado desde o dia 10 continua avisando', () => {
    const slots = slotsFor([monthly()], at('2026-09-12', '11:00'), at('2026-09-12', '12:00'));
    expect(slots.map(describeSlot)).toEqual(['repeat 2026-09-12 12:00']);
    expect(slots[0]).toMatchObject({ dueDate: '2026-09-10', overdueSince: '2026-09-10' });
  });

  it('pontual: aviso antes, no horário, repetição no dia e nada depois', () => {
    const r = once({ notifyBeforeMinutes: 1440 });
    expect(slotsFor([r], at('2026-09-17', '00:00'), at('2026-09-18', '23:59')).map(describeSlot)).toEqual([
      'advance 2026-09-17 14:00',
      'due 2026-09-18 14:00',
      'repeat 2026-09-18 15:00',
      'repeat 2026-09-18 18:00',
    ]);
    expect(slotsFor([r], at('2026-09-19', '00:00'), at('2026-09-19', '23:59'))).toEqual([]);

    const soon = once({ notifyBeforeMinutes: 30, repeat: false });
    expect(slotsFor([soon], at('2026-09-18', '00:00'), at('2026-09-18', '23:59')).map(describeSlot)).toEqual([
      'advance 2026-09-18 13:30',
      'due 2026-09-18 14:00',
    ]);
  });

  it('não dispara o que já tinha passado quando o lembrete foi criado', () => {
    const r = once({ date: '2026-09-16', time: '08:00', createdAt: at('2026-09-16', '10:00').toISOString() });
    expect(slotsFor([r], at('2026-09-16', '00:00'), at('2026-09-16', '23:59')).map(describeSlot)).toEqual([
      'repeat 2026-09-16 12:00',
      'repeat 2026-09-16 15:00',
      'repeat 2026-09-16 18:00',
    ]);
  });

  it('tarefa diária avisa nos horários dela todo dia até ser concluída', () => {
    const open = slotsFor([task()], at('2026-09-16', '00:00'), at('2026-09-17', '23:59'));
    expect(open.map(describeSlot)).toEqual([
      'task 2026-09-16 08:00',
      'task 2026-09-16 14:00',
      'task 2026-09-17 08:00',
      'task 2026-09-17 14:00',
    ]);
    const finished = task({ completedAt: at('2026-09-16', '09:00').toISOString() });
    expect(slotsFor([finished], at('2026-09-16', '10:00'), at('2026-09-17', '23:59'))).toEqual([]);
  });
});

describe('o que vai na notificação', () => {
  it('um aviso por lembrete, com a saudação do horário e o botão Realizado', () => {
    const r = monthly();
    const plan = planNotifications(slotsFor([r], at('2026-09-10', '08:00'), at('2026-09-10', '09:00')), [r]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      title: '🔔 Pagar a conta de luz',
      body: 'Bom dia ☀️! É para hoje, às 09:00.',
      tag: 'lembrete-mensal',
      done: { reminderId: 'mensal', dueDate: '2026-09-10' },
    });

    const afternoon = planNotifications(slotsFor([r], at('2026-09-11', '11:59'), at('2026-09-11', '12:00')), [
      r,
    ]);
    expect(afternoon[0].body).toBe('Boa tarde 🌤️! Atrasado desde 10/09.');
  });

  it('chama a pessoa pelo primeiro nome quando a conta tem um', () => {
    const r = monthly();
    const plan = planNotifications(
      slotsFor([r], at('2026-09-10', '08:00'), at('2026-09-10', '09:00')),
      [r],
      'Enzo',
    );
    expect(plan[0].body).toBe('Bom dia, Enzo ☀️! É para hoje, às 09:00.');
  });

  it('depois de o servidor ficar fora, manda só o aviso mais recente de cada lembrete', () => {
    const r = weekly();
    const slots = slotsFor([r], at('2026-09-16', '07:00'), at('2026-09-16', '13:00'));
    expect(slots).toHaveLength(2);
    const plan = planNotifications(slots, [r]);
    expect(plan).toHaveLength(1);
    expect(plan[0].slots).toHaveLength(2);
    expect(plan[0].body).toContain('Ainda não foi marcado como feito');
  });

  it('agrupa as tarefas do mesmo horário numa notificação só', () => {
    const tasks = [task(), task({ id: 't2', message: 'Ligar para a escola', times: ['08:00'] })];
    const plan = planNotifications(
      slotsFor(tasks, at('2026-09-16', '07:59'), at('2026-09-16', '08:00')),
      tasks,
    );
    expect(plan).toEqual([
      expect.objectContaining({
        title: '📋 2 tarefas para hoje',
        body: '• Mandar o relatório\n• Ligar para a escola',
        done: null,
      }),
    ]);

    const single = planNotifications(
      slotsFor(tasks, at('2026-09-16', '13:59'), at('2026-09-16', '14:00')),
      tasks,
    );
    expect(single[0]).toMatchObject({
      title: '📋 Mandar o relatório',
      body: 'Boa tarde 🌤️! Tarefa de hoje.',
      done: { reminderId: 'tarefa', dueDate: '2026-09-16' },
    });
  });

  it('aviso antecipado do pontual diz quando é', () => {
    const r = once({ notifyBeforeMinutes: 1440 });
    const plan = planNotifications(slotsFor([r], at('2026-09-17', '13:59'), at('2026-09-17', '14:00')), [r]);
    expect(plan[0]).toMatchObject({ title: '📌 Dentista', body: 'Amanhã às 14:00.' });
  });
});

describe('o dia na tela', () => {
  it('separa atrasados, hoje, tarefas e amanhã', () => {
    const reminders: Reminder[] = [
      monthly({ dayOfMonth: 14 }),
      weekly({ weekdays: [3, 4] }),
      once({ date: '2026-09-16', time: '07:00' }),
      task(),
      task({ id: 'feita', message: 'Tarefa feita', completedAt: at('2026-09-16', '09:00').toISOString() }),
      task({ id: 'antiga', message: 'Feita ontem', completedAt: at('2026-09-15', '09:00').toISOString() }),
    ];
    const day = reminderDay(reminders, [{ reminderId: 'pontual', dueDate: '2026-09-16' }], '2026-09-16');

    expect(day.overdue.map((item) => [item.reminder.id, item.overdueSince])).toEqual([
      ['mensal', '2026-09-14'],
    ]);
    expect(day.today.map((item) => [item.reminder.id, item.done])).toEqual([
      ['pontual', true],
      ['semanal', false],
    ]);
    expect(day.tasks.map((item) => [item.task.id, item.done])).toEqual([
      ['tarefa', false],
      ['feita', true],
    ]);
    expect(day.tomorrow.map((item) => item.reminder.id)).toEqual(['semanal']);
  });
});

describe('resumo do agendamento', () => {
  it.each([
    [weekly({ weekdays: [1, 3, 5] }), 'Toda seg, qua e sex às 08:00'],
    [weekly({ weekdays: [1, 2, 3, 4, 5] }), 'Dias úteis às 08:00'],
    [weekly({ weekdays: [0, 1, 2, 3, 4, 5, 6] }), 'Todo dia às 08:00'],
    [monthly({ dayOfMonth: 31 }), 'Todo dia 31 às 09:00 (ou o último dia do mês)'],
    [once({ notifyBeforeMinutes: 60 }), '18/09/2026 às 14:00 · avisa 1 hora antes'],
    [task(), 'Todo dia às 08:00 e 14:00, até concluir'],
  ])('%#', (reminder, text) => {
    expect(scheduleSummary(reminder)).toBe(text);
  });
});
