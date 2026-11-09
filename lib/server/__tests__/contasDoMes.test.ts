// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { zonedInstant } from '@/lib/reminders';
import type { RecurringExpense } from '@/lib/budget';
import { PostgresBudgetRepository } from '../budgetRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresPushRepository, type PushSender } from '../push';
import { runRecurringBillsJob } from '../recurringBills';
import { runRecurringLaunchLink } from '../recurringLaunchLink';
import { runReserveModuleMigration } from '../reserveModuleMigration';
import { PostgresWalletRepository } from '../walletRepository';

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

beforeEach(async () => {
  // The jobs' "last run" (and the one-off markers) are global; every test starts as if none ran.
  await db.delete(schema.jobRuns);
  vi.stubEnv('ACTION_TOKEN_SECRET', 'segredo-de-teste-com-mais-de-16');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('sem rede nos testes')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const at = (date: string, time: string) => zonedInstant(date, time);

async function newAccount(modules: Record<string, boolean> = { expenses: true, recurring: true }) {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  await db.insert(schema.budgetSettings).values({
    userId: id,
    topics: [],
    specialCategories: { fixedCost: 'Custos Fixos', unforeseen: 'Imprevistos' },
    modules,
  });
  await new PostgresPushRepository(db, id).registerDevice(
    { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: 'k', auth: 'a' } },
    null,
  );
  const budget = new PostgresBudgetRepository(db, id);
  return { id, budget, wallet: new PostgresWalletRepository(db, id, budget) };
}

const bill = (overrides: Partial<RecurringExpense> = {}): RecurringExpense => ({
  id: 'luz',
  categoryKind: 'fixedCost',
  description: 'Luz',
  amount: 180,
  card: false,
  dueDay: 10,
  ...overrides,
});

/** Only this account's pushes (the jobs run for every account in the shared database). */
function recordingSender(userId: string) {
  const payloads: { message: Record<string, unknown> }[] = [];
  const sender: PushSender = async (sub, payload) => {
    if (!sub.endpoint.endsWith(userId)) return;
    payloads.push({ message: JSON.parse(payload) as Record<string, unknown> });
  };
  return { sender, payloads };
}

async function runJob(from: Date, to: Date, sender: PushSender) {
  await db
    .insert(schema.jobRuns)
    .values({ name: 'recurring-bills', lastRunAt: from })
    .onConflictDoUpdate({ target: schema.jobRuns.name, set: { lastRunAt: from } });
  return runRecurringBillsJob(db, to, sender);
}

describe('Contas do mês', () => {
  it('guarda o dia do vencimento e sabe o que já foi lançado em cada mês', async () => {
    const { wallet, budget } = await newAccount();
    await wallet.saveRecurring(bill());
    expect((await wallet.getSnapshot()).recurring[0].dueDay).toBe(10);

    await budget.saveExpense('2026-10', {
      id: 'e1',
      categoryKind: 'fixedCost',
      description: 'Luz',
      amount: 175.4,
      date: '2026-10-09',
      source: 'recurring',
      recurringId: 'luz',
    });
    expect((await wallet.getSnapshot()).recurringLaunches).toEqual([
      { recurringId: 'luz', month: '2026-10', date: '2026-10-09' },
    ]);

    // Deleting the expense puts the bill back on the list.
    await budget.deleteExpense('2026-10', 'e1');
    expect((await wallet.getSnapshot()).recurringLaunches).toEqual([]);

    // "Não informar" clears the day.
    await wallet.saveRecurring(bill({ dueDay: undefined }));
    expect((await wallet.getSnapshot()).recurring[0].dueDay).toBeUndefined();
  });

  it('o Lançar da notificação lança a conta uma vez só, e recusa a parcelada', async () => {
    const { wallet, budget } = await newAccount();
    await wallet.saveRecurring(bill());

    expect(await wallet.launchRecurring('luz', '2026-10', '2026-10-10')).toBe('launched');
    expect(await wallet.launchRecurring('luz', '2026-10', '2026-10-10')).toBe('already');
    const month = await budget.getMonth('2026-10');
    expect(month?.expenses.map((e) => [e.description, e.amount, e.recurringId, e.source])).toEqual([
      ['Luz', 180, 'luz', 'recurring'],
    ]);

    await wallet.saveRecurring(bill({ id: 'seguro', card: true, installmentCount: 10 }));
    await expect(wallet.launchRecurring('seguro', '2026-10', '2026-10-10')).rejects.toMatchObject({
      status: 409,
    });
    await expect(wallet.launchRecurring('nada', '2026-10', '2026-10-10')).rejects.toMatchObject({ status: 404 });
  });

  it('avisa no dia do vencimento com o botão Lançar, e para quando a conta é lançada', async () => {
    const { id, wallet } = await newAccount();
    await wallet.saveRecurring(bill());
    await wallet.saveRecurring(bill({ id: 'agua', description: 'Água', amount: 90 }));
    const { sender, payloads } = recordingSender(id);

    await runJob(at('2026-10-09', '09:00'), at('2026-10-10', '09:00'), sender);
    expect(payloads.map((p) => p.message.title).sort()).toEqual(['🧾 Luz', '🧾 Água']);
    expect(payloads[0].message.body).toContain('Vence hoje');
    expect(JSON.stringify(payloads[0].message)).toContain('/api/v1/wallet/recurring/actions/launch');

    // Running the same window again never sends twice.
    await runJob(at('2026-10-09', '09:00'), at('2026-10-10', '09:00'), sender);
    expect(payloads).toHaveLength(2);

    await wallet.launchRecurring('luz', '2026-10', '2026-10-10');
    await runJob(at('2026-10-10', '09:00'), at('2026-10-11', '09:00'), sender);
    expect(payloads).toHaveLength(3);
    expect(payloads[2].message.title).toBe('🧾 Água');
    expect(payloads[2].message.body).toContain('Venceu ontem');
  });

  it('não avisa com o aviso desligado nem sem Lançamentos', async () => {
    const quiet = await newAccount();
    await quiet.wallet.saveRecurring(bill());
    await quiet.wallet.saveRecurringSettings({ notifyEnabled: false, notifyTime: '09:00', repeatUntilLaunched: true });
    const off = await newAccount({ recurring: true, expenses: false });
    await off.wallet.saveRecurring(bill());

    const a = recordingSender(quiet.id);
    const b = recordingSender(off.id);
    await runJob(at('2026-10-09', '09:00'), at('2026-10-10', '09:00'), async (sub, payload, options) => {
      await a.sender(sub, payload, options);
      await b.sender(sub, payload, options);
    });
    expect(a.payloads).toEqual([]);
    expect(b.payloads).toEqual([]);
  });

  it('liga os gastos lançados antes desta versão à conta de onde vieram, só quando não há dúvida', async () => {
    const { wallet, budget, id } = await newAccount();
    await wallet.saveRecurring(bill({ dueDay: undefined }));
    await wallet.saveRecurring(bill({ id: 'net1', description: 'Internet', amount: 100 }));
    await wallet.saveRecurring(bill({ id: 'net2', description: 'Internet', amount: 120 }));
    const old = (expenseId: string, description: string) =>
      budget.saveExpense('2026-10', {
        id: expenseId,
        categoryKind: 'fixedCost',
        description,
        amount: 50,
        date: '2026-10-03',
        source: 'recurring',
      });
    await old('e-luz', 'Luz');
    await old('e-net', 'Internet');

    const result = await runRecurringLaunchLink(db);
    expect(result.skipped).toBe(false);
    const launches = (await wallet.getSnapshot()).recurringLaunches;
    // Luz is unambiguous; two templates are called Internet, so that one is left alone.
    expect(launches).toEqual([{ recurringId: 'luz', month: '2026-10', date: '2026-10-03' }]);

    expect((await runRecurringLaunchLink(db)).skipped).toBe(true);
    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, 'e-net'));
    expect(row.recurringId).toBeNull();
    expect(row.userId).toBe(id);
  });
});

describe('as duas reservas viram uma', () => {
  it('quem usava a reserva investida passa a ter a Reserva ligada, com o widget no lugar', async () => {
    const { id } = await newAccount({ expenses: true, investments: true });
    await db
      .update(schema.budgetSettings)
      .set({ homePages: [['expenses', 'investments'] as never] })
      .where(eq(schema.budgetSettings.userId, id));

    expect((await runReserveModuleMigration(db)).skipped).toBe(false);
    const [row] = await db.select().from(schema.budgetSettings).where(eq(schema.budgetSettings.userId, id));
    expect(row.modules).toEqual({ expenses: true, cash: true });
    expect(row.homePages).toEqual([['expenses', 'cash']]);
    expect((await runReserveModuleMigration(db)).skipped).toBe(true);
  });
});
