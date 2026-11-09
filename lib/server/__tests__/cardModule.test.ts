// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeMonthSummary,
  currentMonthKey,
  nextMonth,
  shiftMonth,
  UNASSIGNED_CARD_ID,
  type Expense,
  type InstallmentPlan,
} from '@/lib/budget';
import { PostgresBudgetRepository } from '../budgetRepository';
import { runCardModuleMigration } from '../cardModuleMigration';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresWalletRepository } from '../walletRepository';

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

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

// ---------------------------------------------------------------------------
// "Em parcelas" tem que aparecer na categoria
// ---------------------------------------------------------------------------

describe('uma compra "em parcelas" na categoria escolhida', () => {
  it('aparece em cada mês da série, inclusive num que ainda não foi aberto, e no "posso gastar"', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const diversos = await topicId(budget);
    await budget.ensureMonth(month);
    await budget.saveIncome(month, { id: randomUUID(), source: 'Salário', amount: 3000 });

    await wallet.saveInstallment(
      planFor(month, { categoryKind: 'topic', topicId: diversos, count: 3, totalAmount: 300 }),
    );

    // O mês aberto: a parcela é um gasto da categoria, como qualquer outro.
    const open = await budget.getMonth(month);
    const summary = computeMonthSummary(open!);
    const topic = summary.topics.find((t) => t.topicId === diversos);
    expect(topic?.spent).toBe(100);
    expect(open?.expenses.map((e) => [e.description, e.topicId])).toEqual([
      ['Notebook 1/3', diversos],
    ]);

    // Um mês que ninguém abriu: a prévia já mostra a parcela na mesma categoria.
    const third = shiftMonth(month, 2);
    const preview = await budget.peekMonth(third);
    expect(preview.expenses.map((e) => [e.description, e.topicId])).toEqual([
      ['Notebook 3/3', diversos],
    ]);
    expect(computeMonthSummary(preview).topics.find((t) => t.topicId === diversos)?.spent).toBe(100);
  });

  it('numa compra "à vista", a categoria recebe o valor inteiro só no mês da compra', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const diversos = await topicId(budget);

    await wallet.saveInstallment(
      planFor(month, {
        categoryKind: 'topic',
        topicId: diversos,
        accounting: 'upfront',
        purchaseDate: `${month}-05`,
        count: 3,
        totalAmount: 300,
      }),
    );

    const open = await budget.getMonth(month);
    expect(computeMonthSummary(open!).topics.find((t) => t.topicId === diversos)?.spent).toBe(300);

    // Nos meses seguintes não há nada na categoria: só a parcela, na fatura.
    const later = await budget.peekMonth(nextMonth(month));
    expect(later.expenses).toEqual([]);
    const { bills } = await wallet.getSnapshot();
    expect(bills.find((bill) => bill.month === nextMonth(month))?.total).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Editar a compra toda
// ---------------------------------------------------------------------------

describe('editar a compra toda', () => {
  it('trocar o modo, a categoria e o cartão refaz os meses da série', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const diversos = await topicId(budget);
    const metas = await topicId(budget, 'Metas');
    await budget.ensureMonth(month);
    await budget.ensureMonth(nextMonth(month));
    await wallet.saveCard({
      id: 'nubank',
      name: 'Nubank',
      dueDay: 10,
      dueMonth: 'next',
      notifyEnabled: false,
      notifyBeforeDays: 0,
      isDefault: true,
      order: 0,
    });

    const plan = planFor(month, {
      categoryKind: 'topic',
      topicId: diversos,
      count: 2,
      totalAmount: 200,
    });
    await wallet.saveInstallment(plan);
    expect((await budget.getMonth(nextMonth(month)))?.expenses).toHaveLength(1);

    // De "em parcelas" para "à vista": um gasto só, no mês da compra, e nada no mês seguinte.
    await wallet.saveInstallment({
      ...plan,
      accounting: 'upfront',
      purchaseDate: `${month}-03`,
      topicId: metas,
      cardId: 'nubank',
    });

    const first = await budget.getMonth(month);
    expect(first?.expenses).toHaveLength(1);
    expect(first?.expenses[0]).toMatchObject({ amount: 200, topicId: metas, installmentNumber: 0 });
    expect((await budget.getMonth(nextMonth(month)))?.expenses).toEqual([]);

    // E de volta: as parcelas voltam, já na categoria e no cartão novos.
    await wallet.saveInstallment({ ...plan, topicId: metas, cardId: 'nubank' });
    const back = await budget.getMonth(month);
    expect(back?.expenses[0]).toMatchObject({ amount: 100, topicId: metas, cardId: 'nubank' });
    expect((await budget.getMonth(nextMonth(month)))?.expenses).toHaveLength(1);
  });

  it('desfaz o ajuste feito na mão numa parcela', async () => {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    await budget.ensureMonth(month);
    const plan = planFor(month, { count: 2, totalAmount: 200 });
    await wallet.saveInstallment(plan);

    const line = (await budget.getMonth(month))!.expenses[0];
    await budget.saveExpense(month, { ...line, amount: 80 });
    expect((await budget.getMonth(month))?.expenses[0].amount).toBe(80);

    await wallet.saveInstallment({ ...plan, name: 'Notebook novo' });
    expect((await budget.getMonth(month))?.expenses[0]).toMatchObject({
      description: 'Notebook novo 1/2',
      amount: 100,
    });
  });
});

// ---------------------------------------------------------------------------
// Meses fechados
// ---------------------------------------------------------------------------

describe('mês fechado trava a compra inteira', () => {
  async function accountWithClosedMonth() {
    const { budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const later = nextMonth(month);
    await budget.ensureMonth(month);
    await budget.ensureMonth(later);
    return { budget, wallet, month, later };
  }

  it('recusa criar uma compra cujas parcelas cairiam num mês fechado', async () => {
    const { budget, wallet, month, later } = await accountWithClosedMonth();
    await budget.closeMonth(later);

    const plan = planFor(month, { count: 2, totalAmount: 200 });
    await expect(wallet.saveInstallment(plan)).rejects.toThrow(/mês fechado/i);
    // Nada foi lançado pela metade: nem o plano, nem a parcela do mês aberto.
    expect((await wallet.getSnapshot()).installments).toEqual([]);
    expect((await budget.getMonth(month))?.expenses).toEqual([]);
  });

  it('recusa editar e recusa excluir, mesmo chamando o repositório direto', async () => {
    const { budget, wallet, month, later } = await accountWithClosedMonth();
    const plan = planFor(month, { count: 2, totalAmount: 200 });
    await wallet.saveInstallment(plan);
    await budget.closeMonth(later);

    await expect(wallet.saveInstallment({ ...plan, totalAmount: 400 })).rejects.toThrow(
      /mês fechado/i,
    );
    await expect(wallet.deleteInstallment(plan.id)).rejects.toThrow(/mês fechado/i);

    // A compra continua exatamente como estava.
    const snapshot = await wallet.getSnapshot();
    expect(snapshot.installments[0].totalAmount).toBe(200);
    expect((await budget.getMonth(later))?.expenses).toHaveLength(1);
    expect(snapshot.closedMonths).toEqual([later]);
  });

  it('reabrir o mês libera a edição', async () => {
    const { budget, wallet, month, later } = await accountWithClosedMonth();
    const plan = planFor(month, { count: 2, totalAmount: 200 });
    await wallet.saveInstallment(plan);
    await budget.closeMonth(later);
    await budget.reopenMonth(later);

    await wallet.saveInstallment({ ...plan, totalAmount: 400 });
    expect((await budget.getMonth(later))?.expenses[0].amount).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Migração para o módulo único
// ---------------------------------------------------------------------------

describe('migração do módulo único', () => {
  it('liga Cartão, arquiva as faturas "Não informado" passadas e liga o gasto do "à vista"', async () => {
    await db.delete(schema.jobRuns);
    const { id, budget, wallet } = await newAccount();
    const month = currentMonthKey();
    const past = shiftMonth(month, -2);

    await db.insert(schema.budgetSettings).values({
      userId: id,
      topics: [],
      specialCategories: { fixedCost: 'Custo Fixo', unforeseen: 'Imprevistos' },
      // As chaves antigas, do jeito que estão gravadas na conta de quem já usava.
      modules: { expenses: true, card: true, cards: true, installments: true } as never,
      nav: ['inicio', 'cards', 'installments'] as never,
      homeOrder: ['installments', 'expenses'] as never,
    });

    // Uma compra sem cartão numa competência passada, como as que saíam sozinhas no dia 1º.
    const old: Expense = {
      id: randomUUID(),
      categoryKind: 'fixedCost',
      description: 'Mercado',
      amount: 90,
      date: `${past}-05`,
      singleInstallmentCard: true,
    };
    await budget.ensureMonth(past);
    await budget.saveExpense(past, old);
    // E uma na competência corrente, que tem de continuar em aberto.
    await budget.ensureMonth(month);
    await budget.saveExpense(month, { ...old, id: randomUUID(), date: `${month}-05`, amount: 40 });

    // Um parcelamento "à vista" do jeito antigo: o gasto existia solto, sem vínculo.
    const plan = planFor(month, { accounting: 'upfront', name: 'Faculdade', totalAmount: 872.36 });
    await db.insert(schema.installments).values({
      userId: id,
      id: plan.id,
      name: plan.name,
      categoryKind: plan.categoryKind,
      firstDebitDate: plan.firstDebitDate,
      count: plan.count,
      totalAmount: plan.totalAmount,
      accounting: 'upfront',
    });
    const loose: Expense = {
      id: randomUUID(),
      categoryKind: 'fixedCost',
      description: 'Faculdade',
      amount: 872.36,
      date: `${month}-02`,
      singleInstallmentCard: true,
      source: 'installment',
    };
    await budget.saveExpense(month, loose);

    const result = await runCardModuleMigration(db);
    expect(result.skipped).toBe(false);
    expect(result.archivedBills).toBe(1);
    expect(result.linkedUpfront).toBe(1);

    const [settings] = await db
      .select()
      .from(schema.budgetSettings)
      .where(eq(schema.budgetSettings.userId, id));
    expect(settings.modules).toEqual({ expenses: true, card: true });
    expect(settings.nav).toEqual(['inicio', 'card']);
    expect(settings.homeOrder).toEqual(['card', 'expenses']);

    // A competência passada foi arquivada na data em que ela saía sozinha; a corrente não.
    const payments = await db
      .select()
      .from(schema.cardBillPayments)
      .where(eq(schema.cardBillPayments.userId, id));
    expect(payments.map((row) => row.month)).toEqual([past]);
    expect(payments[0].cardId).toBe(UNASSIGNED_CARD_ID);
    expect(payments[0].paidAt.toISOString().slice(0, 10)).toBe(`${nextMonth(past)}-01`);

    const snapshot = await wallet.getSnapshot();
    const unassigned = snapshot.bills.filter((bill) => bill.cardId === UNASSIGNED_CARD_ID);
    expect(unassigned.find((bill) => bill.month === past)?.paid).toBe(true);
    expect(unassigned.find((bill) => bill.month === month)?.paid).toBe(false);

    // O gasto do "à vista" foi ligado ao plano, então ele sai da fatura.
    const [linked] = await db
      .select()
      .from(schema.expenses)
      .where(and(eq(schema.expenses.userId, id), eq(schema.expenses.id, loose.id)));
    expect(linked.installmentId).toBe(plan.id);
    expect(linked.installmentNumber).toBe(0);
  });

  it('roda uma vez só: na segunda vez não toca em nada', async () => {
    await db.delete(schema.jobRuns);
    await runCardModuleMigration(db);
    const again = await runCardModuleMigration(db);
    expect(again.skipped).toBe(true);
    expect(again.archivedBills).toBe(0);
  });

  it('não inventa vínculo quando dois gastos poderiam ser o do parcelamento', async () => {
    await db.delete(schema.jobRuns);
    const { id, budget } = await newAccount();
    const month = currentMonthKey();
    const plan = planFor(month, { accounting: 'upfront', name: 'Sofá', totalAmount: 500 });
    await db.insert(schema.installments).values({
      userId: id,
      id: plan.id,
      name: plan.name,
      categoryKind: plan.categoryKind,
      firstDebitDate: plan.firstDebitDate,
      count: plan.count,
      totalAmount: plan.totalAmount,
      accounting: 'upfront',
    });
    const twin: Expense = {
      id: randomUUID(),
      categoryKind: 'fixedCost',
      description: 'Sofá',
      amount: 500,
      date: `${month}-02`,
      singleInstallmentCard: true,
      source: 'installment',
    };
    await budget.ensureMonth(month);
    await budget.saveExpense(month, twin);
    await budget.saveExpense(month, { ...twin, id: randomUUID(), date: `${month}-03` });

    const result = await runCardModuleMigration(db);
    expect(result.linkedUpfront).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// O job de avisos olha o módulo card
// ---------------------------------------------------------------------------

describe('avisos da fatura', () => {
  it('o job procura quem tem o módulo "card" ligado', async () => {
    const { runCardBillsJob } = await import('../cardBills');
    await db.delete(schema.jobRuns);
    const { id } = await newAccount();
    await db.insert(schema.budgetSettings).values({
      userId: id,
      topics: [],
      specialCategories: { fixedCost: 'Custo Fixo', unforeseen: 'Imprevistos' },
      modules: { expenses: true, card: true },
    });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runCardBillsJob(db, new Date());
    spy.mockRestore();
    expect(result.notifications).toBe(0);
  });
});
