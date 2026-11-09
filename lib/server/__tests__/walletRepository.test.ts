// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeMonthSummary,
  currentMonthKey,
  nextMonth,
  shiftMonth,
  todayISO,
  type InstallmentPlan,
} from '@/lib/budget';
import { PostgresBudgetRepository } from '../budgetRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresWalletRepository } from '../walletRepository';

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

// No test ever reaches B3 or Yahoo: the network is off unless a test mocks an answer.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('sem rede nos testes')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function newAccount() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  const budget = new PostgresBudgetRepository(db, id);
  return { id, budget, wallet: new PostgresWalletRepository(db, id, budget) };
}

async function topicId(budget: PostgresBudgetRepository, name = 'Prazeres e Confortos'): Promise<string> {
  const settings = await budget.getSettings();
  return settings.topics.find((t) => t.name === name)!.id;
}

async function setPrice(ticker: string, price: number, fetchedAt = new Date()) {
  await db
    .insert(schema.priceCache)
    .values({ ticker, price, fetchedAt })
    .onConflictDoUpdate({ target: schema.priceCache.ticker, set: { price, fetchedAt } });
}

/** B3's answer for `ticker` at `price`, the shape cotacao.b3.com.br really returns. */
function b3Answer(ticker: string, price: number, desc: string) {
  return new Response(
    JSON.stringify({
      BizSts: { cd: 'OK' },
      Trad: [{ scty: { SctyQtn: { curPrc: price }, symb: ticker, desc } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** A plan whose first charge is in `month`, so its charges are easy to place in tests. */
function planFor(month: string, overrides: Partial<InstallmentPlan> = {}): InstallmentPlan {
  return {
    id: randomUUID(),
    name: 'Notebook',
    categoryKind: 'fixedCost',
    firstDebitDate: `${month}-10`,
    count: 3,
    totalAmount: 300,
    accounting: 'installment',
    ...overrides,
  };
}

describe('PostgresWalletRepository', () => {
  it('keeps recurring templates per account, in the order they were created', async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    await alice.wallet.saveRecurring({
      id: 'r1',
      categoryKind: 'fixedCost',
      description: 'Aluguel',
      amount: 1500,
      card: false,
    });
    await alice.wallet.saveRecurring({
      id: 'r2',
      categoryKind: 'fixedCost',
      description: 'Internet',
      amount: 120,
      card: true,
    });

    const snapshot = await alice.wallet.getSnapshot();
    expect(snapshot.recurring.map((r) => r.description)).toEqual(['Aluguel', 'Internet']);
    expect(snapshot.recurring[1].card).toBe(true);
    expect((await bob.wallet.getSnapshot()).recurring).toEqual([]);

    await alice.wallet.saveRecurring({
      id: 'r1',
      categoryKind: 'topic',
      topicId: await topicId(alice.budget),
      description: 'Aluguel novo',
      amount: 1600,
      card: false,
    });
    const edited = await alice.wallet.getSnapshot();
    expect(edited.recurring.map((r) => r.description)).toEqual(['Aluguel novo', 'Internet']);

    await alice.wallet.deleteRecurring('r1');
    expect((await alice.wallet.getSnapshot()).recurring).toHaveLength(1);
  });

  it('keeps a recurring template that is paid in instalments, and drops it when the card goes', async () => {
    const { wallet } = await newAccount();
    await wallet.saveRecurring({
      id: 'r1',
      categoryKind: 'fixedCost',
      description: 'Faculdade',
      amount: 872.36,
      card: true,
      installmentCount: 10,
      installmentAccounting: 'upfront',
    });

    const [saved] = (await wallet.getSnapshot()).recurring;
    expect(saved.installmentCount).toBe(10);
    expect(saved.installmentAccounting).toBe('upfront');

    // Parcelar só existe no cartão: tirando o cartão, o modelo volta a ser um gasto comum.
    await wallet.saveRecurring({ ...saved, card: false });
    const [plain] = (await wallet.getSnapshot()).recurring;
    expect(plain.installmentCount).toBeUndefined();
    expect(plain.installmentAccounting).toBeUndefined();
  });

  it('charges the instalment of a plan into the months that already exist and are open', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    await budget.ensureMonth(month);
    await budget.ensureMonth(nextMonth(month));

    const plan = planFor(month);
    await wallet.saveInstallment(plan);

    const first = await budget.getMonth(month);
    const second = await budget.getMonth(nextMonth(month));
    expect(first?.expenses.map((e) => e.description)).toEqual(['Notebook 1/3']);
    expect(first?.expenses[0]).toMatchObject({
      amount: 100,
      singleInstallmentCard: true,
      source: 'installment',
      installmentId: plan.id,
      installmentNumber: 1,
    });
    expect(second?.expenses.map((e) => e.description)).toEqual(['Notebook 2/3']);
  });

  it('shows the coming instalment in a month that does not exist yet, and keeps it when it does', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const third = shiftMonth(month, 2);
    await wallet.saveInstallment(planFor(month));

    const preview = await budget.peekMonth(third);
    expect(preview.expenses.map((e) => e.description)).toEqual(['Notebook 3/3']);
    expect(await budget.listMonths()).not.toContain(third);

    const created = await budget.ensureMonth(third);
    expect(created.expenses.map((e) => e.description)).toEqual(['Notebook 3/3']);
    expect((await budget.getMonth(third))?.expenses).toHaveLength(1);
  });

  it('tells each instalment the day of its purchase, without storing it', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const bought = `${shiftMonth(month, -7)}-15`;
    await budget.ensureMonth(month);
    await wallet.saveInstallment(planFor(month, { purchaseDate: bought }));
    // A plan registered without the day of the purchase falls back to its first charge.
    await wallet.saveInstallment(planFor(shiftMonth(month, -1), { name: 'Celular' }));

    const charges = (await budget.getMonth(month))?.expenses;
    expect(charges?.find((e) => e.description === 'Notebook 1/3')?.purchaseDate).toBe(bought);
    expect(charges?.find((e) => e.description === 'Celular 2/3')?.purchaseDate).toBe(
      `${shiftMonth(month, -1)}-10`,
    );
    const preview = (await budget.peekMonth(nextMonth(month))).expenses;
    expect(preview.find((e) => e.description === 'Notebook 2/3')?.purchaseDate).toBe(bought);
    // The backup carries only what is stored: the charge keeps the day the bank debits it.
    const stored = (await budget.exportData()).months.find((m) => m.month === month)?.expenses;
    expect(stored?.every((e) => e.purchaseDate === undefined)).toBe(true);
  });

  it('never charges the same instalment twice, however many times the plan is saved', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const later = nextMonth(month);
    await budget.ensureMonth(month);
    await budget.ensureMonth(later);

    const plan = planFor(month);
    await wallet.saveInstallment(plan);
    await wallet.saveInstallment(plan);
    expect((await budget.getMonth(month))?.expenses).toHaveLength(1);
    expect((await budget.getMonth(later))?.expenses).toHaveLength(1);
  });

  it('an "à vista" plan is one expense in the category, marked as instalment zero', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const plan = planFor(month, {
      accounting: 'upfront',
      name: 'Faculdade',
      totalAmount: 872.36,
      purchaseDate: `${month}-05`,
    });

    await wallet.saveInstallment(plan);

    const data = await budget.getMonth(month);
    expect(data?.expenses).toHaveLength(1);
    expect(data?.expenses[0]).toMatchObject({
      description: 'Faculdade',
      amount: 872.36,
      date: `${month}-05`,
      singleInstallmentCard: true,
      installmentId: plan.id,
      installmentNumber: 0,
    });

    // The whole purchase is budget; the bill of the month only gets the instalment (872,36 / 3).
    const { bills } = await wallet.getSnapshot();
    expect(bills.find((bill) => bill.month === month)?.total).toBe(290.79);
  });

  it('deleting a plan takes every expense it created with it', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const previous = shiftMonth(month, -1);
    await budget.ensureMonth(previous);
    await budget.ensureMonth(month);
    await budget.ensureMonth(nextMonth(month));

    const plan = planFor(previous, { firstDebitDate: `${previous}-10` });
    await wallet.saveInstallment(plan);
    expect((await budget.getMonth(nextMonth(month)))?.expenses).toHaveLength(1);

    await wallet.deleteInstallment(plan.id);

    expect((await wallet.getSnapshot()).installments).toEqual([]);
    expect((await budget.getMonth(previous))?.expenses).toEqual([]);
    expect((await budget.getMonth(nextMonth(month)))?.expenses).toEqual([]);
  });

  it('allocates money to a bucket: quotas in, expense in the bucket topic', async () => {
    const { budget, wallet } = await newAccount();
    const metas = await topicId(budget, 'Metas');
    const month = currentMonthKey();
    await setPrice('AUPO11', 100);
    await wallet.tradeQuotas(50);
    await wallet.saveBucket({ id: 'b1', name: 'Metas', topicId: metas, quotas: 0 });

    await wallet.allocate({ bucketId: 'b1', amount: 250, month, date: todayISO() });

    const snapshot = await wallet.getSnapshot();
    expect(snapshot.investments.buckets[0].quotas).toBeCloseTo(2.5, 8);
    expect(snapshot.investments.freeQuotas).toBeCloseTo(47.5, 8);
    expect(snapshot.investments.freeValue).toBe(4750);

    const data = await budget.getMonth(month);
    expect(data?.expenses[0]).toMatchObject({
      description: 'AUPO11',
      amount: 250,
      topicId: metas,
      source: 'investment',
      singleInstallmentCard: false,
    });
    expect(computeMonthSummary(data!).topics.find((t) => t.topicId === metas)?.spent).toBe(250);
  });

  it('takes money back out of a bucket: quotas to the free reserve, estorno in the month', async () => {
    const { budget, wallet } = await newAccount();
    const metas = await topicId(budget, 'Metas');
    const month = currentMonthKey();
    await setPrice('AUPO11', 100);
    await wallet.tradeQuotas(50);
    await wallet.saveBucket({ id: 'b1', name: 'Metas', topicId: metas, quotas: 0 });
    await wallet.allocate({ bucketId: 'b1', amount: 250, month, date: todayISO() });

    await wallet.allocate({ bucketId: 'b1', amount: 100, direction: 'out', month, date: todayISO() });

    const snapshot = await wallet.getSnapshot();
    expect(snapshot.investments.buckets[0].quotas).toBeCloseTo(1.5, 8);
    expect(snapshot.investments.freeQuotas).toBeCloseTo(48.5, 8);

    const data = await budget.getMonth(month);
    const estorno = data?.expenses.find((e) => e.amount < 0);
    expect(estorno).toMatchObject({ description: 'AUPO11 (retirada)', amount: -100, topicId: metas });
    // O que ficou guardado é o que a categoria do orçamento mostra como gasto.
    expect(computeMonthSummary(data!).topics.find((t) => t.topicId === metas)?.spent).toBe(150);
  });

  it('refuses to take out of a bucket more than it holds', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    await setPrice('AUPO11', 100);
    await wallet.tradeQuotas(50);
    await wallet.saveBucket({ id: 'b1', name: 'Metas', topicId: await topicId(budget), quotas: 1 });

    await expect(
      wallet.allocate({ bucketId: 'b1', amount: 500, direction: 'out', month, date: todayISO() }),
    ).rejects.toThrow(/não dá para retirar/i);
  });

  it('registers a purchase that started before the account: the past is left alone', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const old = shiftMonth(month, -3);
    await budget.ensureMonth(old);
    await budget.ensureMonth(month);

    // Seis parcelas, começando três meses atrás, com as três primeiras já pagas por fora.
    const plan = planFor(old, { count: 6, totalAmount: 600, paidCount: 3 });
    await wallet.saveInstallment(plan);

    expect((await budget.getMonth(old))?.expenses).toEqual([]);
    expect((await budget.getMonth(month))?.expenses.map((e) => e.description)).toEqual([
      'Notebook 4/6',
    ]);
    const snapshot = await wallet.getSnapshot();
    expect(snapshot.installments[0].paidCount).toBe(3);
    expect(snapshot.cash.report.installmentDebt).toBe(-200);
  });

  it('advances the last charges: the plan gets shorter and what was paid lands in the month', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    await budget.ensureMonth(month);
    await budget.ensureMonth(nextMonth(month));

    const plan = planFor(month, { count: 3, totalAmount: 300 });
    await wallet.saveInstallment(plan);
    expect((await budget.getMonth(nextMonth(month)))?.expenses).toHaveLength(1);

    await wallet.advanceInstallment(plan.id, { count: 2, discount: 30, date: todayISO(), month });

    const snapshot = await wallet.getSnapshot();
    expect(snapshot.installments[0].advancedCount).toBe(2);
    // As parcelas adiantadas saem dos meses em que iam cair.
    expect((await budget.getMonth(nextMonth(month)))?.expenses).toEqual([]);

    const data = await budget.getMonth(month);
    const advance = data?.expenses.find((e) => e.description.startsWith('Adiantamento'));
    expect(advance).toMatchObject({
      description: 'Adiantamento · Notebook',
      amount: 170,
      categoryKind: 'fixedCost',
      singleInstallmentCard: true,
    });
    // Nada de dívida sobrando: a compra ficou só com a parcela deste mês.
    expect(snapshot.cash.report.installmentDebt).toBe(0);
  });

  it('refuses to advance more charges than the purchase still has to pay', async () => {
    const { wallet } = await newAccount();
    const month = currentMonthKey();
    const plan = planFor(month, { count: 3, totalAmount: 300 });
    await wallet.saveInstallment(plan);

    await expect(
      wallet.advanceInstallment(plan.id, { count: 9, discount: 0, date: todayISO(), month }),
    ).rejects.toThrow(/parcelas/i);
  });

  it('plano da reserva: a parcela vira gasto do mês e anda com o plano', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    await wallet.saveCashSettings({
      reserveAccountAmount: 1000,
      emergencyCosts: [{ label: 'Aluguel', amount: 1500 }],
      reserveMultiplier: 6,
    });
    await wallet.saveReservePlan({
      targetAmount: 5000,
      months: 10,
      startMonth: month,
      reason: 'Cirurgia',
    });

    await wallet.contributeToReserve({
      amount: 500,
      month,
      date: todayISO(),
      categoryKind: 'unforeseen',
    });

    const snapshot = await wallet.getSnapshot();
    expect(snapshot.cash.plan).toMatchObject({
      contributed: 500,
      remaining: 4500,
      monthly: 500,
      contributedThisMonth: 500,
      monthsLeft: 9,
      done: false,
    });
    // O plano acompanha o compromisso, não o cofre: onde o dinheiro fica continua sendo a pessoa
    // quem diz, na reserva em conta e nas cotas.
    expect(snapshot.cash.settings.reserveAccountAmount).toBe(1000);
    expect(snapshot.investments.totalQuotas).toBe(0);

    const data = await budget.getMonth(month);
    expect(data?.expenses[0]).toMatchObject({
      description: 'Recompor a reserva',
      amount: 500,
      categoryKind: 'unforeseen',
      source: 'reserve',
      singleInstallmentCard: false,
    });
    // Imprevisto é rateado entre as categorias, então o plano aperta o mês de verdade.
    expect(computeMonthSummary(data!).unforeseenTotal).toBe(500);
  });

  it('plano da reserva: duas parcelas no mesmo mês somam, e o plano fecha no fim', async () => {
    const { wallet } = await newAccount();
    const month = currentMonthKey();
    await wallet.saveReservePlan({ targetAmount: 300, months: 3, startMonth: month });

    for (const amount of [100, 200]) {
      await wallet.contributeToReserve({ amount, month, date: todayISO(), categoryKind: 'unforeseen' });
    }

    const plan = (await wallet.getSnapshot()).cash.plan;
    expect(plan).toMatchObject({ contributed: 300, contributedThisMonth: 300, remaining: 0, done: true });
  });

  it('plano da reserva: recusa lançar sem plano, e desistir não apaga os gastos', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();

    await expect(
      wallet.contributeToReserve({
        amount: 100,
        month,
        date: todayISO(),
        categoryKind: 'unforeseen',
      }),
    ).rejects.toThrow(/plano/i);

    await wallet.saveReservePlan({ targetAmount: 300, months: 3, startMonth: month });
    await wallet.contributeToReserve({
      amount: 100,
      month,
      date: todayISO(),
      categoryKind: 'unforeseen',
    });
    await wallet.deleteReservePlan();

    expect((await wallet.getSnapshot()).cash.plan).toBeNull();
    // O gasto do mês fica onde está: ele aconteceu, o plano é que acabou.
    expect((await budget.getMonth(month))?.expenses).toHaveLength(1);
  });

  it('refreshes an old price by itself, for free, when the user holds quotas', async () => {
    const { wallet } = await newAccount();
    await wallet.setTicker('BOVA11');
    await wallet.tradeQuotas(10);
    await setPrice('BOVA11', 100, new Date(Date.now() - 60 * 60_000));
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      b3Answer('BOVA11', 183.72, 'ISHARES   BOVACI'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { investments } = await wallet.getSnapshot();

    expect(investments.price).toBe(183.72);
    expect(investments.source).toBe('b3');
    expect(investments.assetName).toBe('ISHARES BOVACI');
    expect(investments.totalValue).toBe(1837.2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('cotacao.b3.com.br');

    // Fresh now: opening the Carteira again does not ask the sources again.
    await wallet.getSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached price when the sources are down, and never fetches for who holds nothing', async () => {
    const holder = await newAccount();
    await holder.wallet.setTicker('HGLG11');
    await holder.wallet.tradeQuotas(5);
    await setPrice('HGLG11', 150, new Date(Date.now() - 60 * 60_000));
    // The default fetch mock rejects: B3 and Yahoo are both "down".
    const { investments } = await holder.wallet.getSnapshot();
    expect(investments.price).toBe(150);
    expect(investments.stale).toBe(true);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const nobody = await newAccount();
    await nobody.wallet.getSnapshot();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to allocate without a quote or to sell quotas that do not exist', async () => {
    const { budget, wallet } = await newAccount();
    await wallet.setTicker('XPTO11');
    await wallet.saveBucket({ id: 'b1', name: 'Metas', topicId: await topicId(budget), quotas: 0 });

    await expect(
      wallet.allocate({ bucketId: 'b1', amount: 10, month: currentMonthKey(), date: todayISO() }),
    ).rejects.toThrow(/cotação/i);
    await expect(wallet.tradeQuotas(-1)).rejects.toThrow(/cotas/i);
  });

  it('reports the cash: reserve, card of the open month and what the plans still owe', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    await setPrice('AUPO11', 10);
    await wallet.tradeQuotas(100);
    await wallet.saveCashSettings({
      reserveAccountAmount: 1000,
      emergencyCosts: [
        { label: 'Contas', amount: 900 },
        { label: 'Faculdade', amount: 500 },
      ],
      reserveMultiplier: 6,
    });
    await budget.saveExpense(month, {
      id: 'e1',
      categoryKind: 'fixedCost',
      description: 'Mercado no cartão',
      amount: 200,
      date: `${month}-02`,
      singleInstallmentCard: true,
    });
    // A plan whose charges are all in the future: nothing of it was launched yet.
    const future = shiftMonth(month, 6);
    await wallet.saveInstallment(planFor(future, { count: 2, totalAmount: 200 }));

    const { cash } = await wallet.getSnapshot();
    expect(cash.report.cardMonth).toBe(month);
    expect(cash.report.cardDebt).toBe(-200);
    expect(cash.report.installmentDebt).toBe(-200);
    expect(cash.report.totalReserve).toBe(2000);
    expect(cash.report.totalDebt).toBe(-400);
    expect(cash.report.expectedReserve).toBe(8400);
    expect(cash.report.gap).toBe(2000 - 400 - 8400);
  });

  it('counts the instalment of the current competence as bill, and only the later ones as debt', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const plan = planFor(month, { count: 2, totalAmount: 200 });
    await wallet.saveInstallment(plan);

    // The charge of this competence is already on the bill; only the next one is debt.
    const before = await wallet.getSnapshot();
    expect(before.cash.report.installmentDebt).toBe(-100);
    expect(before.bills.find((bill) => bill.month === month)?.total).toBe(100);

    // Creating the later month writes the expense, and it stays debt, never bill in the open.
    await budget.ensureMonth(nextMonth(month));
    const after = await wallet.getSnapshot();
    expect(after.cash.report.installmentDebt).toBe(-100);
    expect(after.bills.find((bill) => bill.month === nextMonth(month))?.future).toBe(true);
  });
});
