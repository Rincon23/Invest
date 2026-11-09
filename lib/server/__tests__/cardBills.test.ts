// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { zonedInstant } from '@/lib/reminders';
import { currentMonthKey, UNASSIGNED_CARD_ID, type CreditCard, type Expense } from '@/lib/budget';
import { PostgresBudgetRepository } from '../budgetRepository';
import { runCardBillsJob } from '../cardBills';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresPushRepository, type PushSender } from '../push';
import { PostgresWalletRepository } from '../walletRepository';

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

beforeEach(async () => {
  // The scheduler's "last run" is global; every test starts as if it never ran.
  await db.delete(schema.jobRuns);
});

const at = (date: string, time: string) => zonedInstant(date, time);

const card = (overrides: Partial<CreditCard> = {}): CreditCard => ({
  id: 'nubank',
  name: 'Nubank',
  dueDay: 10,
  dueMonth: 'next',
  notifyEnabled: true,
  notifyBeforeDays: 1,
  isDefault: true,
  order: 0,
  ...overrides,
});

async function newAccount({ module = true, device = true } = {}) {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  await db.insert(schema.budgetSettings).values({
    userId: id,
    topics: [],
    specialCategories: { fixedCost: 'Custo Fixo', unforeseen: 'Imprevistos' },
    modules: { expenses: true, card: module },
  });
  if (device) {
    await new PostgresPushRepository(db, id).registerDevice(
      { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: 'k', auth: 'a' } },
      null,
    );
  }
  const budget = new PostgresBudgetRepository(db, id);
  return { id, budget, wallet: new PostgresWalletRepository(db, id, budget) };
}

/** A card purchase of `month`, on `cardId` when given. */
async function purchase(
  budget: PostgresBudgetRepository,
  month: string,
  amount: number,
  cardId?: string,
): Promise<void> {
  await budget.ensureMonth(month);
  const expense: Expense = {
    id: randomUUID(),
    categoryKind: 'fixedCost',
    description: 'Compra',
    amount,
    date: `${month}-05`,
    singleInstallmentCard: true,
    ...(cardId ? { cardId } : {}),
  };
  await budget.saveExpense(month, expense);
}

/**
 * The job runs for every account in the database, and the tests share one; `userId` keeps each
 * test looking only at its own pushes (the endpoint of `newAccount` carries the account id).
 */
function recordingSender(userId: string) {
  const payloads: { message: Record<string, unknown> }[] = [];
  const sender: PushSender = async (sub, payload) => {
    if (!sub.endpoint.endsWith(userId)) return;
    payloads.push({ message: JSON.parse(payload) as Record<string, unknown> });
  };
  return { sender, payloads };
}

describe('faturas dos cartões', () => {
  it('nenhuma fatura sai sozinha: a do cartão e a "Não informado" esperam ser marcadas como pagas', async () => {
    const month = currentMonthKey();
    const { wallet, budget } = await newAccount();
    await purchase(budget, month, 300);

    const before = await wallet.getSnapshot();
    expect(before.cash.report.cardDebt).toBe(-300);

    await wallet.saveCard(card());
    await purchase(budget, month, 200, 'nubank');

    const both = await wallet.getSnapshot();
    expect(both.cash.report.cardDebt).toBe(-500);
    expect(both.bills.map((bill) => [bill.cardName, bill.total])).toEqual(
      expect.arrayContaining([
        ['Nubank', 200],
        ['Não informado', 300],
      ]),
    );

    await wallet.payBill({ cardId: 'nubank', month });
    const paid = await wallet.getSnapshot();
    // A "Não informado" continua lá: ela também só sai quando for marcada como paga.
    expect(paid.cash.report.cardDebt).toBe(-300);
    expect(paid.bills.find((bill) => bill.cardId === 'nubank')?.paid).toBe(true);

    await wallet.payBill({ cardId: UNASSIGNED_CARD_ID, month });
    expect((await wallet.getSnapshot()).cash.report.cardDebt).toBe(0);

    await wallet.unpayBill({ cardId: UNASSIGNED_CARD_ID, month });
    expect((await wallet.getSnapshot()).cash.report.cardDebt).toBe(-300);
  });

  it('excluir o cartão mantém as compras, na fatura "Não informado", e apaga as faturas pagas dele', async () => {
    const month = currentMonthKey();
    const { wallet, budget } = await newAccount();
    await wallet.saveCard(card());
    await purchase(budget, month, 150, 'nubank');
    await wallet.payBill({ cardId: 'nubank', month });

    await wallet.deleteCard('nubank');
    const snapshot = await wallet.getSnapshot();
    expect(snapshot.cards).toEqual([]);
    expect(snapshot.bills.map((bill) => [bill.cardName, bill.total])).toEqual([['Não informado', 150]]);
    // A fatura volta a contar como dívida: o pagamento era do cartão que deixou de existir.
    expect(snapshot.bills[0].paid).toBe(false);
  });

  it('o primeiro cartão é sempre o padrão, e só um é', async () => {
    const { wallet } = await newAccount();
    await wallet.saveCard(card({ isDefault: false }));
    await wallet.saveCard(card({ id: 'itau', name: 'Itaú', isDefault: true }));

    const list = await wallet.listCards();
    expect(list.filter((item) => item.isDefault).map((item) => item.id)).toEqual(['itau']);
  });
});

describe('avisos da fatura', () => {
  it('avisa 1 dia antes, no dia e depois insiste, sempre pela data já adiada do fim de semana', async () => {
    const { id, wallet, budget } = await newAccount();
    // A fatura de julho vence no dia 1º de agosto de 2026, um sábado: passa para segunda, 03/08.
    await wallet.saveCard(card({ dueDay: 1 }));
    await purchase(budget, '2026-07', 1000, 'nubank');

    const { sender, payloads } = recordingSender(id);
    const run = (from: string, to: string) =>
      db
        .insert(schema.jobRuns)
        .values({ name: 'card-bills', lastRunAt: at(from, '09:00') })
        .onConflictDoUpdate({ target: schema.jobRuns.name, set: { lastRunAt: at(from, '09:00') } })
        .then(() => runCardBillsJob(db, at(to, '09:00'), sender));

    // Véspera (domingo 02/08), porque o vencimento efetivo é a segunda 03/08.
    await run('2026-08-01', '2026-08-02');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].message.body).toContain('Vence amanhã, dia 03/08');

    await run('2026-08-02', '2026-08-03');
    expect(payloads).toHaveLength(2);
    expect(payloads[1].message.body).toContain('Vence hoje');

    await run('2026-08-03', '2026-08-05');
    expect(payloads).toHaveLength(3);
    expect(payloads[2].message.body).toContain('Atrasada há 2 dias');
    expect(payloads[2].message.title).toBe('💳 Fatura do Nubank');

    // Paga: nada mais é enviado.
    await wallet.payBill({ cardId: 'nubank', month: '2026-07' });
    await run('2026-08-05', '2026-08-06');
    expect(payloads).toHaveLength(3);
  });

  it('não avisa quem não tem o módulo, nem cartão com aviso desligado', async () => {
    const off = await newAccount({ module: false });
    await off.wallet.saveCard(card());
    await purchase(off.budget, '2026-09', 500, 'nubank');

    const quiet = await newAccount();
    await quiet.wallet.saveCard(card({ notifyEnabled: false }));
    await purchase(quiet.budget, '2026-09', 500, 'nubank');

    const { sender: offSender, payloads: offPayloads } = recordingSender(off.id);
    const { sender: quietSender, payloads: quietPayloads } = recordingSender(quiet.id);
    const sender: PushSender = async (sub, payload, options) => {
      await offSender(sub, payload, options);
      await quietSender(sub, payload, options);
    };
    await db.insert(schema.jobRuns).values({ name: 'card-bills', lastRunAt: at('2026-10-09', '00:00') });
    await runCardBillsJob(db, at('2026-10-13', '23:00'), sender);
    expect(offPayloads).toEqual([]);
    expect(quietPayloads).toEqual([]);
  });

  it('nunca avisa duas vezes o mesmo horário, mesmo rodando de novo', async () => {
    const { id, wallet, budget } = await newAccount();
    await wallet.saveCard(card({ notifyBeforeDays: 0 }));
    await purchase(budget, '2026-09', 700, 'nubank');

    const { sender, payloads } = recordingSender(id);
    await db.insert(schema.jobRuns).values({ name: 'card-bills', lastRunAt: at('2026-10-11', '09:00') });
    // 10/10/2026 é um sábado: o vencimento efetivo é segunda, 12/10.
    await runCardBillsJob(db, at('2026-10-12', '09:30'), sender);
    expect(payloads).toHaveLength(1);

    await db
      .update(schema.jobRuns)
      .set({ lastRunAt: at('2026-10-11', '09:00') })
      .where(eq(schema.jobRuns.name, 'card-bills'));
    await runCardBillsJob(db, at('2026-10-12', '09:30'), sender);
    expect(payloads).toHaveLength(1);
  });
});
