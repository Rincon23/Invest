// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { zonedInstant, type ReminderInput } from '@/lib/reminders';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresPushRepository, type PushSender } from '../push';
import { signReminderAction, verifyReminderAction } from '../reminderActionToken';
import { PostgresRemindersRepository } from '../remindersRepository';
import { runRemindersJob } from '../scheduler';

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

beforeEach(async () => {
  // The scheduler's "last run" is global; every test starts as if it never ran.
  await db.delete(schema.jobRuns);
  vi.stubEnv('ACTION_TOKEN_SECRET', 'segredo-de-teste-com-mais-de-16');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const at = (date: string, time: string) => zonedInstant(date, time);

async function newAccount({ module = true, device = true } = {}) {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  await db.insert(schema.budgetSettings).values({
    userId: id,
    topics: [],
    specialCategories: { fixedCost: 'Custo Fixo', unforeseen: 'Imprevistos' },
    modules: { reminders: module },
  });
  if (device) {
    await new PostgresPushRepository(db, id).registerDevice(
      { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: 'k', auth: 'a' } },
      null,
    );
  }
  return { id, reminders: new PostgresRemindersRepository(db, id) };
}

/** Creates the reminder as if it had been created at `createdAt`. */
async function create(
  repo: PostgresRemindersRepository,
  userId: string,
  input: ReminderInput,
  createdAt = at('2026-09-01', '12:00'),
) {
  await repo.saveReminder(input);
  await db.update(schema.reminders).set({ createdAt }).where(eq(schema.reminders.id, input.id));
}

function recordingSender() {
  const payloads: { endpoint: string; message: Record<string, unknown> }[] = [];
  const sender: PushSender = async (sub, payload) => {
    payloads.push({ endpoint: sub.endpoint, message: JSON.parse(payload) });
  };
  return { sender, payloads };
}

const monthlyBill = (id: string = randomUUID()): ReminderInput => ({
  id,
  kind: 'monthly',
  message: 'Pagar a conta de luz',
  dayOfMonth: 10,
  time: '09:00',
  repeat: true,
});

describe('repositório de lembretes', () => {
  it('guarda cada tipo e devolve no mesmo formato, só para o dono', async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    await alice.reminders.saveReminder({
      id: 'r1',
      kind: 'daily',
      message: 'Relatório',
      times: ['14:00', '08:00', '08:00'],
      repeat: true,
    });
    await alice.reminders.saveReminder({
      id: 'r2',
      kind: 'weekly',
      message: 'Plantas',
      weekdays: [5, 1, 1],
      time: '07:30',
      repeat: false,
    });

    const snapshot = await alice.reminders.getSnapshot(at('2026-09-16', '10:00'));
    expect(snapshot.today).toBe('2026-09-16');
    expect(snapshot.reminders).toEqual([
      expect.objectContaining({ id: 'r1', kind: 'daily', times: ['08:00', '14:00'], completedAt: null }),
      expect.objectContaining({ id: 'r2', kind: 'weekly', weekdays: [1, 5], time: '07:30', repeat: false }),
    ]);
    expect((await bob.reminders.getSnapshot()).reminders).toEqual([]);

    await bob.reminders.deleteReminder('r1');
    expect((await alice.reminders.getSnapshot()).reminders).toHaveLength(2);
  });

  it('Realizado no mensal quita também os dias atrasados, e dá para desfazer', async () => {
    const { id, reminders } = await newAccount();
    const bill = monthlyBill();
    await create(reminders, id, bill, at('2026-08-01', '12:00'));

    await reminders.setDone(bill.id, '2026-09-10', true);
    const snapshot = await reminders.getSnapshot(at('2026-09-16', '10:00'));
    expect(snapshot.completions.map((c) => c.dueDate).sort()).toEqual(['2026-08-10', '2026-09-10']);

    await reminders.setDone(bill.id, '2026-09-10', false);
    const undone = await reminders.getSnapshot(at('2026-09-16', '10:00'));
    expect(undone.completions.map((c) => c.dueDate).sort()).toEqual(['2026-08-10']);

    await expect(reminders.setDone(bill.id, '2026-09-11', true)).rejects.toMatchObject({ code: 'NOT_DUE' });
  });

  it('concluir uma tarefa diária arquiva só ela', async () => {
    const { reminders } = await newAccount();
    const task = (id: string): ReminderInput => ({
      id,
      kind: 'daily',
      message: 'Mesmo texto',
      times: ['08:00'],
      repeat: true,
    });
    await reminders.saveReminder(task('t1'));
    await reminders.saveReminder(task('t2'));

    await reminders.setDone('t1', '2026-09-16', true, at('2026-09-16', '09:00'));
    const list = (await reminders.getSnapshot()).reminders;
    expect(list.find((r) => r.id === 't1')).toMatchObject({
      completedAt: at('2026-09-16', '09:00').toISOString(),
    });
    expect(list.find((r) => r.id === 't2')).toMatchObject({ completedAt: null });
  });
});

describe('agendador', () => {
  it('envia no minuto certo, com o botão Realizado, e nunca duas vezes', async () => {
    const { id, reminders } = await newAccount();
    const bill = monthlyBill();
    await create(reminders, id, bill);
    const { sender, payloads } = recordingSender();

    // Rodada das 08:59: nada ainda.
    await runRemindersJob(db, at('2026-09-10', '08:59'), sender);
    expect(payloads).toHaveLength(0);

    await runRemindersJob(db, at('2026-09-10', '09:00'), sender);
    const mine = payloads.filter((p) => p.endpoint.endsWith(id));
    expect(mine).toHaveLength(1);
    expect(mine[0].message).toMatchObject({
      title: '🔔 Pagar a conta de luz',
      tag: `lembrete-${bill.id}`,
      actions: [expect.objectContaining({ action: 'done', endpoint: '/api/v1/reminders/actions/done' })],
    });

    // A mesma janela de novo (reinício, dois processos): nada é reenviado.
    await db.delete(schema.jobRuns);
    await db.insert(schema.jobRuns).values({ name: 'reminders', lastRunAt: at('2026-09-10', '08:59') });
    await runRemindersJob(db, at('2026-09-10', '09:00'), sender);
    expect(payloads.filter((p) => p.endpoint.endsWith(id))).toHaveLength(1);
  });

  it('depois de ficar fora do ar, manda o que perdeu uma vez só', async () => {
    const { id, reminders } = await newAccount();
    await create(reminders, id, monthlyBill());
    const { sender, payloads } = recordingSender();

    await runRemindersJob(db, at('2026-09-10', '08:00'), sender);
    // Servidor fora das 08:00 às 12:30: perdeu 09:00 e 12:00.
    await runRemindersJob(db, at('2026-09-10', '12:30'), sender);

    const mine = payloads.filter((p) => p.endpoint.endsWith(id));
    expect(mine).toHaveLength(1);
    expect(mine[0].message.body).toContain('Ainda não foi marcado como feito');
  });

  it('só avisa quem ligou o módulo e tem aparelho, e para quando é marcado feito', async () => {
    const on = await newAccount();
    const off = await newAccount({ module: false });
    const noDevice = await newAccount({ device: false });
    for (const account of [on, off, noDevice])
      await create(account.reminders, account.id, monthlyBill('conta-' + account.id));
    const { sender, payloads } = recordingSender();

    await runRemindersJob(db, at('2026-09-10', '08:59'), sender);
    await runRemindersJob(db, at('2026-09-10', '09:00'), sender);
    expect(payloads.map((p) => p.endpoint)).toEqual([`https://fcm.googleapis.com/fcm/send/${on.id}`]);

    await on.reminders.setDone('conta-' + on.id, '2026-09-10', true);
    await runRemindersJob(db, at('2026-09-10', '12:00'), sender);
    expect(payloads).toHaveLength(1);
  });

  it('agrupa as tarefas do horário numa notificação só', async () => {
    const { id, reminders } = await newAccount();
    for (const message of ['Relatório', 'Ligar para a escola', 'Comprar pão']) {
      await create(reminders, id, {
        id: randomUUID(),
        kind: 'daily',
        message,
        times: ['08:00'],
        repeat: true,
      });
    }
    const { sender, payloads } = recordingSender();

    await runRemindersJob(db, at('2026-09-16', '07:59'), sender);
    await runRemindersJob(db, at('2026-09-16', '08:00'), sender);

    const mine = payloads.filter((p) => p.endpoint.endsWith(id));
    expect(mine).toHaveLength(1);
    expect(mine[0].message).toMatchObject({ title: '📋 Teste, 3 tarefas para hoje', tag: 'tarefas' });
    expect(mine[0].message.actions).toBeUndefined();
  });

  it('manda num push só tudo o que vence no mesmo minuto, e registra cada um', async () => {
    const { id, reminders } = await newAccount();
    await create(reminders, id, {
      id: randomUUID(),
      kind: 'weekly',
      message: 'Ver o óleo do carro',
      weekdays: [3],
      time: '08:00',
      repeat: false,
    });
    for (const message of ['Relatório', 'Comprar pão']) {
      await create(reminders, id, {
        id: randomUUID(),
        kind: 'daily',
        message,
        times: ['08:00'],
        repeat: true,
      });
    }
    const { sender, payloads } = recordingSender();

    await runRemindersJob(db, at('2026-09-16', '07:59'), sender);
    await runRemindersJob(db, at('2026-09-16', '08:00'), sender);

    const mine = payloads.filter((p) => p.endpoint.endsWith(id));
    expect(mine).toHaveLength(1);
    expect(mine[0].message).toMatchObject({ title: '🔔 Ver o óleo do carro' });
    expect(mine[0].message.more).toMatchObject([{ title: '📋 Teste, 2 tarefas para hoje', tag: 'tarefas' }]);
    const logged = await db
      .select({ title: schema.notifications.title })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, id));
    expect(logged).toHaveLength(2);
  });
});

describe('token do botão Realizado', () => {
  const action = { userId: randomUUID(), reminderId: 'r1', dueDate: '2026-09-10' };

  it('vale por 36 horas para aquele lembrete e aquele dia', () => {
    const now = at('2026-09-10', '09:00');
    const token = signReminderAction(action, now)!;
    expect(verifyReminderAction(token, new Date(now.getTime() + 35 * 3600_000))).toEqual({
      ok: true,
      action,
    });
    expect(verifyReminderAction(token, new Date(now.getTime() + 37 * 3600_000))).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('recusa token adulterado ou assinado com outro segredo', () => {
    const token = signReminderAction(action)!;
    const [data, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ u: randomUUID(), r: 'r1', d: '2026-09-10', e: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifyReminderAction(`${forged}.${signature}`)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyReminderAction(`${data}.x${signature.slice(1)}`)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyReminderAction('lixo')).toEqual({ ok: false, reason: 'invalid' });

    vi.stubEnv('ACTION_TOKEN_SECRET', 'outro-segredo-com-mais-de-16-letras');
    expect(verifyReminderAction(token)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('sem segredo configurado, a notificação sai sem o botão', () => {
    vi.stubEnv('ACTION_TOKEN_SECRET', '');
    expect(signReminderAction(action)).toBeNull();
  });
});
