import { describe, expect, it } from 'vitest';
import { billLines, futureInstallmentTotal, plannedCharges } from '../bill';
import { computeMonthSummary } from '../calculations';
import {
  activeInstallmentCount,
  advanceExpense,
  advancePaid,
  advanceProblem,
  advanceTotal,
  advancedPlanOf,
  expenseDayLabel,
  expenseListDate,
  installmentDebt,
  installmentEndDate,
  installmentsDueIn,
  isInstallmentFinished,
  monthsTouchedBy,
  remainingInstallments,
} from '../installments';
import type { Expense, InstallmentPlan, MonthData, TopicConfig } from '../types';

/**
 * Two things can take a charge out of a purchase without it ever being wrong: it was paid before
 * the purchase was registered here (`paidCount`), or it was paid ahead of time (`advancedCount`).
 * These tests pin down that such a charge is gone from everywhere at once — the bill, the budget,
 * the debt and the months the purchase is allowed to touch — because a charge that still showed
 * up in one of them is exactly the kind of money that gets counted twice.
 */

const CARD = 'nubank';
const TODAY = '2026-09-20';

function plan(overrides: Partial<InstallmentPlan> = {}): InstallmentPlan {
  return {
    id: 'p1',
    name: 'Celular',
    categoryKind: 'topic',
    topicId: 't1',
    firstDebitDate: '2026-04-10',
    purchaseDate: '2026-03-15',
    count: 12,
    totalAmount: 1200,
    accounting: 'installment',
    cardId: CARD,
    ...overrides,
  };
}

describe('parcelas já pagas antes do cadastro', () => {
  const started = plan({ paidCount: 6 });

  it('deixa no parcelamento só o que ainda falta', () => {
    expect(activeInstallmentCount(started)).toBe(6);
    expect(remainingInstallments(started, TODAY)).toBe(6);
    expect(installmentEndDate(started)).toBe('2027-03-10');
  });

  it('não cobra nada nos meses que já passaram', () => {
    const charges = plannedCharges([started]);
    expect(charges[0].month).toBe('2026-10');
    expect(charges).toHaveLength(6);
    expect(installmentsDueIn([started], '2026-05')).toEqual([]);
    expect(installmentsDueIn([started], '2026-10')).toHaveLength(1);
  });

  it('não deixa um mês antigo fechado travar o cadastro', () => {
    expect(monthsTouchedBy(started)).not.toContain('2026-04');
    expect(monthsTouchedBy(started)[0]).toBe('2026-10');
  });

  it('só conta como dívida o que ainda vai ser cobrado', () => {
    expect(installmentDebt([started], '2026-09')).toBe(-600);
    expect(futureInstallmentTotal([started], '2026-09', CARD)).toBe(600);
  });
});

describe('adiantar parcelas', () => {
  const full = plan({ paidCount: 0, firstDebitDate: '2026-10-10' });

  it('diz o que foi pago, com e sem desconto', () => {
    expect(advanceTotal(full, 3)).toBe(300);
    expect(advancePaid(full, { count: 3, discount: 0 })).toBe(300);
    expect(advancePaid(full, { count: 3, discount: 50 })).toBe(250);
  });

  it('recusa adiantar mais parcelas do que faltam, ou um desconto maior que elas', () => {
    expect(advanceProblem(full, { count: 3, discount: 0 }, TODAY)).toBeNull();
    expect(advanceProblem(full, { count: 13, discount: 0 }, TODAY)).toContain('Faltam 12 parcelas');
    expect(advanceProblem(full, { count: 3, discount: 400 }, TODAY)).toContain('desconto');
    expect(advanceProblem(full, { count: 0, discount: 0 }, TODAY)).toContain('quantas parcelas');
  });

  it('encurta a compra pelo fim, sem mexer no valor de cada parcela', () => {
    const after = advancedPlanOf(full, 3);
    expect(after.count).toBe(12);
    expect(after.totalAmount).toBe(1200);
    expect(after.advancedCount).toBe(3);
    expect(remainingInstallments(after, TODAY)).toBe(9);
    expect(installmentEndDate(after)).toBe('2027-06-10');
    expect(installmentDebt([after], '2026-09')).toBe(-900);
  });

  it('quita a compra quando adianta tudo o que falta', () => {
    const after = advancedPlanOf(full, 12);
    expect(isInstallmentFinished(after, TODAY)).toBe(true);
    expect(plannedCharges([after])).toEqual([]);
  });

  it('nunca adianta mais do que a compra tem', () => {
    expect(advancedPlanOf(full, 99).advancedCount).toBe(12);
  });

  it('em parcelas, o que foi pago conta na categoria da compra', () => {
    const expense = advanceExpense(full, { count: 3, discount: 50, date: TODAY }, 'e1');
    expect(expense.categoryKind).toBe('topic');
    expect(expense.topicId).toBe('t1');
    expect(expense.amount).toBe(250);
    expect(expense.singleInstallmentCard).toBe(true);
    expect(expense.cardId).toBe(CARD);
    expect(expense.description).toBe('Adiantamento · Celular');
  });

  it('à vista, o pagamento entra na fatura sem consumir categoria nenhuma', () => {
    const expense = advanceExpense(
      plan({ accounting: 'upfront', firstDebitDate: '2026-10-10' }),
      { count: 2, discount: 0, date: TODAY },
      'e2',
    );
    // A compra inteira já contou no mês em que foi feita: contar de novo seria cobrar duas vezes.
    expect(expense.categoryKind).toBe('uncounted');
    expect(expense.topicId).toBeUndefined();
    expect(expense.singleInstallmentCard).toBe(true);
  });

  it('a parcela adiantada sai da fatura do mês em que ia cair', () => {
    const after = advancedPlanOf(plan({ firstDebitDate: '2026-09-10', count: 3 }), 2);
    const lines = billLines({ expenses: [], plans: [after], month: '2026-10' });
    expect(lines).toEqual([]);
  });
});

describe('a categoria "Fora do orçamento"', () => {
  const topics: TopicConfig[] = [
    { id: 't1', name: 'Diversos', targetPct: 1, order: 0, color: '#2a78d6' },
  ];

  function month(expenses: Expense[]): MonthData {
    return {
      month: '2026-09',
      incomes: [{ id: 'i1', source: 'Salário', amount: 1000 }],
      expenses,
      carryIn: {},
      topicsSnapshot: topics,
    };
  }

  it('fica fora de toda categoria e do total gasto, mas entra na fatura', () => {
    const summary = computeMonthSummary(
      month([
        {
          id: 'e1',
          categoryKind: 'topic',
          topicId: 't1',
          description: 'Mercado',
          amount: 230,
          date: '2026-09-10',
        },
        {
          id: 'e2',
          categoryKind: 'uncounted',
          description: 'Adiantamento · Celular',
          amount: 100,
          date: '2026-09-20',
          singleInstallmentCard: true,
          cardId: CARD,
        },
      ]),
      topics,
    );
    expect(summary.uncountedTotal).toBe(100);
    expect(summary.expenseTotal).toBe(230);
    expect(summary.topics[0].spent).toBe(230);
    // Na fatura ela está: o banco vai cobrar de qualquer jeito.
    expect(summary.cardTotal).toBe(100);
  });
});

describe('a parcela nas listas de gastos', () => {
  const mercado = { date: '2026-10-05' };
  const tenis = { date: '2026-10-11', purchaseDate: '2026-03-15' };
  const geladeira = { date: '2026-10-11', purchaseDate: '2025-12-20' };

  it('fica no dia da compra, não no dia em que o banco cobra', () => {
    const order = [geladeira, mercado, tenis].sort((a, b) =>
      expenseListDate(b).localeCompare(expenseListDate(a)),
    );
    expect(order).toEqual([mercado, tenis, geladeira]);
  });

  it('mostra o dia da compra, com o ano quando é de outro ano', () => {
    expect(expenseDayLabel(mercado)).toBe('05/10');
    expect(expenseDayLabel(tenis)).toBe('compra em 15/03');
    expect(expenseDayLabel(geladeira)).toBe('compra em 20/12/25');
    // A compra cobrada no mesmo dia em que foi feita não precisa dizer nada a mais.
    expect(expenseDayLabel({ date: '2026-10-11', purchaseDate: '2026-10-11' })).toBe('11/10');
  });
});
