// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Expense } from '../../budget/types';
import { ALL_MODULES } from '../../modules';
import { clearAccountData } from '../accountData';
import { PostgresBudgetRepository } from '../budgetRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresMissionsRepository } from '../missionsRepository';
import { PostgresRemindersRepository } from '../remindersRepository';
import { PostgresWalletRepository } from '../walletRepository';

/**
 * The XP of the Missões: given by the server, for what the account has or for where the app says
 * it went, once per period by the server's date — never for an amount, never twice.
 */

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

/** 26/10/2026 at noon in São Paulo. */
const MONDAY = new Date('2026-10-26T15:00:00Z');
const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

async function newAccount() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Pessoa', email: `${id}@teste.local` });
  return {
    id,
    budget: new PostgresBudgetRepository(db, id),
    missions: new PostgresMissionsRepository(db, id),
  };
}

function expense(amount: number, date: string, overrides: Partial<Expense> = {}): Expense {
  return { id: randomUUID(), categoryKind: 'unforeseen', description: 'x', amount, date, ...overrides };
}

const done = (status: Awaited<ReturnType<PostgresMissionsRepository['check']>>, key: string) =>
  status.missions.find((mission) => mission.key === key)?.done;

describe('Missões', () => {
  it('dá o XP do que a conta fez, uma vez por período, seja qual for o valor', async () => {
    const { budget, missions } = await newAccount();
    // Opening the app gives nothing by itself: the XP of the day comes with "Resgatar".
    const opened = await missions.check({ modules: ALL_MODULES, now: MONDAY });
    expect(opened.earned).toEqual([]);
    expect(done(opened, 'open-app')).toBe(false);
    const first = await missions.check({ modules: ALL_MODULES, visits: ['open-app'], now: MONDAY });
    expect(first.earned).toEqual([{ key: 'open-app', xp: 10 }]);
    expect(first.xp).toBe(10);

    await budget.ensureMonth('2026-10');
    await budget.saveExpense('2026-10', expense(0.01, '2026-10-26'));
    await budget.saveExpense('2026-10', expense(9999, '2026-10-26'));
    const after = await missions.check({ modules: ALL_MODULES, now: MONDAY });
    expect(after.earned.map((item) => item.key).sort()).toEqual(['first-expense', 'month-expense']);
    expect(after.xp).toBe(10 + 50 + 30);

    // Fifty more expenses give nothing more this month; deleting does not take the XP back.
    for (let i = 0; i < 5; i++) await budget.saveExpense('2026-10', expense(10, '2026-10-26'));
    const again = await missions.check({ modules: ALL_MODULES, visits: ['open-app'], now: MONDAY });
    expect(again.earned).toEqual([]);
    expect(again.xp).toBe(90);
    expect(done(again, 'month-expense')).toBe(true);
  });

  it('recomeça no dia, na semana e no mês seguintes, pela data do servidor', async () => {
    const { budget, missions } = await newAccount();
    await missions.check({ modules: ALL_MODULES, visits: ['open-app'], now: MONDAY });
    const tuesday = await missions.check({ modules: ALL_MODULES, visits: ['open-app'], now: at('2026-10-27') });
    expect(tuesday.earned).toEqual([{ key: 'open-app', xp: 10 }]);

    await budget.ensureMonth('2026-11');
    await budget.saveExpense('2026-11', expense(10, '2026-11-02'));
    const november = await missions.check({ modules: ALL_MODULES, now: at('2026-11-02') });
    expect(november.earned.map((item) => item.key).sort()).toEqual(['first-expense', 'month-expense']);
    // Back in October nothing of November counts.
    const october = await missions.check({ modules: ALL_MODULES, now: at('2026-10-28') });
    expect(done(october, 'month-expense')).toBe(false);
  });

  it('as parcelas que o mês novo ganha sozinho não contam como "Lançar um gasto"; registrar a compra conta', async () => {
    const { id, budget, missions } = await newAccount();
    const wallet = new PostgresWalletRepository(db, id, budget);
    await budget.ensureMonth('2026-10');
    await wallet.saveInstallment({
      id: 'tv',
      name: 'TV',
      categoryKind: 'unforeseen',
      firstDebitDate: '2026-11-10',
      purchaseDate: '2026-10-20',
      count: 10,
      totalAmount: 1000,
      accounting: 'installment',
    });
    // Registered on 20/10, with its first charge only in November: October still counts it.
    await db
      .update(schema.installments)
      .set({ createdAt: new Date('2026-10-20T15:00:00Z') })
      .where(eq(schema.installments.userId, id));
    const october = await missions.check({ modules: ALL_MODULES, now: MONDAY });
    expect(done(october, 'month-expense')).toBe(true);

    // November gets its charge by itself when it is created: that is not the person logging one.
    await budget.ensureMonth('2026-11');
    expect((await budget.getMonth('2026-11'))?.expenses).toHaveLength(1);
    const november = await missions.check({ modules: ALL_MODULES, now: at('2026-11-02') });
    expect(done(november, 'month-expense')).toBe(false);
    await budget.saveExpense('2026-11', expense(10, '2026-11-02'));
    expect(done(await missions.check({ modules: ALL_MODULES, now: at('2026-11-02') }), 'month-expense')).toBe(true);
  });

  it('só aceita visita de missão que se faz indo até o lugar, e que a conta tem', async () => {
    const { missions } = await newAccount();
    const status = await missions.check({
      modules: { ...ALL_MODULES, banks: false },
      visits: ['meet-card', 'first-expense', 'meet-banks', 'check-card', 'inventada'],
      now: MONDAY,
    });
    // first-expense is done by data, banks is restricted, check-card needs a card.
    expect(status.earned).toEqual([{ key: 'meet-card', xp: 20 }]);
    expect(status.missions.some((mission) => mission.key === 'meet-banks')).toBe(false);
  });

  it('o lembrete e a renda contam pelo que a conta tem; as categorias, só pelo "Concluir configuração"', async () => {
    const { id, budget, missions } = await newAccount();
    await budget.getSettings();
    await budget.completeOnboarding();
    await budget.ensureMonth('2026-10');
    await budget.saveIncome('2026-10', { id: randomUUID(), source: 'Salário', amount: 3000, date: '2026-10-05' });
    await new PostgresRemindersRepository(db, id).saveReminder({
      id: 'r1',
      kind: 'daily',
      message: 'Relatório',
      times: ['08:00'],
      repeat: false,
    });
    const status = await missions.check({ modules: ALL_MODULES, now: MONDAY });
    expect(status.earned.map((item) => item.key).sort()).toEqual([
      'first-income',
      'first-reminder',
      'month-income',
    ]);
    // Skipping the questions marks them done, but gives nothing: "Concluir configuração" does.
    const finished = await missions.check({ modules: ALL_MODULES, visits: ['setup-categories'], now: MONDAY });
    expect(finished.earned).toEqual([{ key: 'setup-categories', xp: 50 }]);
  });

  it('conhecer um módulo restrito não dá XP, nem a quem tem acesso, e o que deu antes deixa de contar', async () => {
    const { missions } = await newAccount();
    await missions.check({ modules: ALL_MODULES, visits: ['meet-banks', 'meet-card'], now: MONDAY });
    const status = await missions.check({ modules: ALL_MODULES, restricted: ['banks'], now: MONDAY });
    expect(status.xp).toBe(20);
    expect(status.missions.some((mission) => mission.key === 'meet-banks')).toBe(false);
    expect(status.missions.some((mission) => mission.key === 'connect-bank')).toBe(true);
    const diagram = await missions.check({ modules: ALL_MODULES, restricted: ['diagram'], visits: ['meet-diagram'], now: MONDAY });
    expect(diagram.earned).toEqual([]);
  });

  it('a conta modelo não ganha nada, e "Apagar todos os dados" zera o XP', async () => {
    const { id, missions } = await newAccount();
    const template = await missions.check({ modules: ALL_MODULES, visits: ['open-app'], now: MONDAY, record: false });
    expect(template.earned).toEqual([]);
    expect(template.xp).toBe(0);

    await missions.check({ modules: ALL_MODULES, visits: ['open-app', 'meet-missions'], now: MONDAY });
    expect((await missions.check({ modules: ALL_MODULES, now: MONDAY })).xp).toBe(30);
    await clearAccountData(db, id);
    expect((await missions.check({ modules: ALL_MODULES, now: MONDAY, record: false })).xp).toBe(0);
  });

  it('mostra o XP de cada mês, do mais novo para o mais velho', async () => {
    const { missions } = await newAccount();
    await missions.check({ modules: ALL_MODULES, visits: ['open-app'], now: MONDAY });
    const status = await missions.check({ modules: ALL_MODULES, now: MONDAY });
    expect(status.months[0].xp).toBeGreaterThanOrEqual(10);
    expect(status.months[0].month).toMatch(/^\d{4}-\d{2}$/);
  });
});
