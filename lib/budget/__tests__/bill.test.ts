import { describe, expect, it } from 'vitest';
import {
  billComposition,
  billLines,
  billLinesTotal,
  billTotals,
  futureInstallmentTotal,
  launchedCharges,
  pendingCharges,
} from '../bill';
import { cardBills, openCardDebt, UNASSIGNED_CARD_ID } from '../cards';
import { installmentDebt, installmentExpense, upfrontExpense } from '../installments';
import type { Expense, InstallmentPlan } from '../types';

/**
 * The bill is what the bank charges; the budget is what eats a category. These tests pin the
 * difference down: a purchase in 1× is one instalment, an "à vista" plan is a single expense in
 * the category and an instalment on each bill, and a competence still ahead is not a bill at all.
 */

const CARD = 'nubank';

function expense(overrides: Partial<Expense> & { id: string }): Expense {
  return {
    categoryKind: 'topic',
    topicId: 't1',
    description: 'Compra',
    amount: 100,
    date: '2026-09-10',
    singleInstallmentCard: true,
    cardId: CARD,
    ...overrides,
  };
}

function plan(overrides: Partial<InstallmentPlan> = {}): InstallmentPlan {
  return {
    id: 'p1',
    name: 'Notebook',
    categoryKind: 'topic',
    topicId: 't1',
    firstDebitDate: '2026-09-10',
    count: 10,
    totalAmount: 1000,
    accounting: 'installment',
    cardId: CARD,
    ...overrides,
  };
}

describe('a fatura de uma competência', () => {
  it('soma a compra em 1×, que é o caso de uma parcela só', () => {
    const lines = billLines({
      expenses: [expense({ id: 'e1', description: 'Mercado', amount: 230 })],
      plans: [],
      month: '2026-09',
    });
    expect(lines.map((line) => line.description)).toEqual(['Mercado']);
    expect(billLinesTotal(lines)).toBe(230);
    expect(billComposition(lines)).toEqual({ purchases: 230, installments: 0 });
  });

  it('não conta um gasto que não foi no cartão', () => {
    const lines = billLines({
      expenses: [expense({ id: 'e1', singleInstallmentCard: false })],
      plans: [],
      month: '2026-09',
    });
    expect(lines).toEqual([]);
  });

  it('conta a parcela pela linha do mês, inclusive quando ela foi ajustada na mão', () => {
    const series = plan();
    const line = { ...installmentExpense(series, 1, '2026-09-10'), amount: 90 };
    const lines = billLines({ expenses: [line], plans: [series], month: '2026-09' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ description: 'Notebook 1/10', amount: 90, virtual: false });
    expect(billComposition(lines)).toEqual({ purchases: 0, installments: 90 });
  });

  it('conta a parcela de um mês que ninguém abriu, mesmo sem linha de gasto', () => {
    const series = plan();
    const lines = billLines({ expenses: [], plans: [series], month: '2026-11' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ description: 'Notebook 3/10', amount: 100, virtual: true });
  });

  it('numa compra à vista, o gasto único fica fora e a parcela fica dentro', () => {
    const series = plan({ accounting: 'upfront', purchaseDate: '2026-09-05' });
    const single = upfrontExpense(series);
    expect(single.installmentNumber).toBe(0);

    const lines = billLines({ expenses: [single], plans: [series], month: '2026-09' });
    // O gasto inteiro (R$ 1.000) é orçamento: na fatura entra só a parcela de setembro.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ description: 'Notebook 1/10', amount: 100, virtual: true });
    expect(billLinesTotal(lines)).toBe(100);
  });

  it('a parcela sem cartão herda o cartão do parcelamento', () => {
    const series = plan();
    const line = { ...installmentExpense(series, 1, '2026-09-10'), cardId: undefined };
    const lines = billLines({ expenses: [line], plans: [series], month: '2026-09' });
    expect(lines[0].cardId).toBe(CARD);
  });

  it('sem cartão em lugar nenhum, a linha vai para a fatura "Não informado"', () => {
    const lines = billLines({
      expenses: [expense({ id: 'e1', cardId: undefined })],
      plans: [],
      month: '2026-09',
    });
    expect(lines[0].cardId).toBe(UNASSIGNED_CARD_ID);
  });
});

describe('as faturas de todas as competências (o lado do servidor)', () => {
  it('junta as linhas já lançadas com as parcelas que ainda não têm linha', () => {
    const series = plan({ count: 3, totalAmount: 300 });
    const launched = launchedCharges([installmentExpense(series, 1, '2026-09-10')]);
    const totals = billTotals(
      [{ month: '2026-09', cardId: CARD, total: 330 }],
      pendingCharges([series], launched),
    );
    expect(totals.find((row) => row.month === '2026-09')?.total).toBe(330);
    expect(totals.find((row) => row.month === '2026-10')?.total).toBe(100);
    expect(totals.find((row) => row.month === '2026-11')?.total).toBe(100);
  });

  it('a competência futura fica fora da dívida das faturas e dentro da dos parcelados', () => {
    const series = plan({ count: 3, totalAmount: 300 });
    const totals = billTotals([], pendingCharges([series], new Set()));
    const bills = cardBills(
      [
        {
          id: CARD,
          name: 'Nubank',
          dueDay: 10,
          dueMonth: 'next',
          notifyEnabled: true,
          notifyBeforeDays: 1,
          isDefault: true,
          order: 0,
        },
      ],
      totals,
      [],
      '2026-09-15',
    );
    // Setembro é fatura em aberto; outubro e novembro ainda não são.
    expect(openCardDebt(bills)).toBe(-100);
    expect(installmentDebt([series], '2026-09')).toBe(-200);
    expect(futureInstallmentTotal([series], '2026-09', CARD)).toBe(200);
  });

  it('cada real é contado uma vez só: faturas em aberto + parcelas futuras', () => {
    const series = plan({ count: 3, totalAmount: 300 });
    const open = 100;
    expect(open + Math.abs(installmentDebt([series], '2026-09'))).toBe(300);
  });
});
