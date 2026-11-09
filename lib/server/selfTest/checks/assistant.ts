import { randomUUID } from 'node:crypto';
import { levelOf } from '../../../gamification/levels';
import { effectiveModules } from '../../../modules';
import { notificationSlots } from '../../../reminders';
import { addDays } from '../../../reminders/time';
import { expect, expectEqual, type SelfCheck } from '../check';

/** Lembretes and Missões. */

const HOUR_MS = 60 * 60 * 1000;

export const remindersChecks: SelfCheck[] = [
  {
    id: 'reminders.schedule',
    name: 'Lembrete e tarefa do dia têm aviso marcado',
    run: ({ scratch }) =>
      scratch(async ({ reminders, today }) => {
        const now = new Date();
        const task = randomUUID();
        const appointment = randomUUID();
        await reminders.saveReminder({
          id: task,
          kind: 'daily',
          message: 'Beber água',
          repeat: false,
          times: ['08:00', '20:00'],
        });
        await reminders.saveReminder({
          id: appointment,
          kind: 'once',
          message: 'Dentista',
          repeat: false,
          date: addDays(today, 1),
          time: '09:00',
          notifyBeforeMinutes: null,
        });

        const slotsFor = async (id: string) => {
          const schedule = await reminders.loadSchedule(now);
          return notificationSlots(schedule, now, new Date(now.getTime() + 48 * HOUR_MS)).filter(
            (slot) => slot.reminderId === id,
          );
        };
        expect(
          (await slotsFor(task)).length > 0,
          'A tarefa do dia não tem nenhum aviso nas próximas 48 horas.',
        );
        expect((await slotsFor(appointment)).length > 0, 'O lembrete de amanhã não tem aviso marcado.');

        await reminders.setDone(task, today, true, now);
        expectEqual((await slotsFor(task)).length, 0, 'Avisos da tarefa depois de "Realizado"');
      }),
  },
];

export const missionsChecks: SelfCheck[] = [
  {
    id: 'missions.xp',
    name: 'Missão cumprida dá XP uma vez só',
    run: ({ scratch }) =>
      scratch(async ({ budget, missions, month, today }) => {
        const modules = effectiveModules({ vip: true, vipModules: [] });
        await budget.saveIncome(month, { id: randomUUID(), source: 'Salário', amount: 1000, date: today });

        const first = await missions.check({ modules, now: new Date() });
        const earned = first.earned.map((item) => item.key);
        expect(
          earned.includes('first-income'),
          'A primeira renda não deu a missão "Registrar a primeira renda".',
        );
        expect(earned.includes('month-income'), 'A renda do mês não deu a missão "Registrar uma renda".');
        expectEqual(
          first.xp,
          first.earned.reduce((total, item) => total + item.xp, 0),
          'XP da conta',
        );
        expect(levelOf(first.xp).level >= 1, 'O nível da conta não foi calculado.');

        const second = await missions.check({ modules, now: new Date() });
        expectEqual(second.earned.length, 0, 'Missões ganhas de novo na segunda conferência');
        expectEqual(second.xp, first.xp, 'XP depois da segunda conferência');
      }),
  },
];
