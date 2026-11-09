import { describe, expect, it } from 'vitest';
import { computeMonthSummary } from '../calculations';
import { createId } from '../id';
import type { Expense, Income, MonthData, TopicConfig } from '../types';

/**
 * Acceptance fixtures taken from the real spreadsheet on 15/09/2026 (§9 of the bot spec),
 * which is what the Telegram assistant shows today. They pin the budgeting math the app
 * inherits, plus the "A receber" rules: it counts on the card bill and nowhere else.
 *
 * The spreadsheet does not round between steps and Capital rounds every step with `round2`,
 * so each number is compared with a R$ 0,01 tolerance (`toBeCloseTo(x, 2)` is tighter than
 * that and would fail on, for example, 13,26 against 13,254).
 */
const TOLERANCE = 0.01;

function expectMoney(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE + 1e-9);
}

const TOPICS: TopicConfig[] = [
  { id: 'diversos', name: 'Diversos', targetPct: 0.2, order: 0 },
  { id: 'liberdade', name: 'Liberdade Financeira', targetPct: 0.45, order: 1 },
  { id: 'metas', name: 'Metas', targetPct: 0.25, order: 2 },
  { id: 'conhecimento', name: 'Conhecimento', targetPct: 0.1, order: 3 },
];

function income(amount: number): Income {
  return { id: createId(), source: 'Ganho', amount, date: '2026-09-10' };
}

function expense(
  partial: Pick<Expense, 'categoryKind' | 'amount'> & Partial<Expense>,
): Expense {
  return {
    id: createId(),
    description: 'Lançamento',
    date: '2026-09-10',
    ...partial,
  };
}

/** The open month exactly as the spreadsheet had it on 15/09/2026. */
function openMonth(): MonthData {
  return {
    month: '2026-09',
    incomes: [income(300), income(21.39), income(73.33)],
    expenses: [
      expense({ categoryKind: 'fixedCost', description: 'Gasolina', amount: 30, singleInstallmentCard: true }),
      expense({ categoryKind: 'fixedCost', description: 'Faculdade', amount: 872.36 }),
      ...[140.37, 144.8, 33, 28, 29.5, 129.8].map((amount) =>
        expense({ categoryKind: 'topic', topicId: 'diversos', amount, singleInstallmentCard: true }),
      ),
      expense({ categoryKind: 'reimbursable', description: 'Compra para outra pessoa', amount: 73, singleInstallmentCard: true }),
      expense({ categoryKind: 'unforeseen', description: 'Estacionamento', amount: 9.95, singleInstallmentCard: true }),
      expense({ categoryKind: 'topic', topicId: 'conhecimento', amount: 110, singleInstallmentCard: true }),
    ],
    carryIn: {
      diversos: 622.242,
      liberdade: 453.782,
      metas: 302.99,
      conhecimento: 187.596,
    },
    topicsSnapshot: TOPICS,
  };
}

describe('planilha de 15/09/2026 (fixtures da spec §9)', () => {
  const summary = computeMonthSummary(openMonth());
  const topic = (id: string) => {
    const result = summary.topics.find((t) => t.topicId === id);
    if (!result) throw new Error(`tópico ${id} ausente no resumo`);
    return result;
  };

  it('soma a renda do mês', () => {
    expectMoney(summary.incomeTotal, 394.72);
  });

  it('soma custos fixos e imprevistos (fixosImprev = 912,31)', () => {
    expectMoney(summary.fixedTotal + summary.unforeseenTotal, 912.31);
  });

  it.each([
    ['diversos', 182.462, 518.724, 505.47, 13.254],
    ['liberdade', 410.5395, 220.8665, 0, 220.8665],
    ['metas', 228.0775, 173.5925, 0, 173.5925],
    ['conhecimento', 91.231, 135.837, 110, 25.837],
  ])('%s: rateio, posso gastar, gasto e sobra', (id, proportional, available, spent, remaining) => {
    expectMoney(topic(id).proportionalFixed, proportional);
    expectMoney(topic(id).available, available);
    expectMoney(topic(id).spent, spent);
    expectMoney(topic(id).remaining, remaining);
  });

  it('soma as sobras no saldo geral', () => {
    expectMoney(summary.balance, 13.254 + 220.8665 + 173.5925 + 25.837);
  });

  it('fecha a dívida do cartão em 728,42, com os 73,00 a receber dentro', () => {
    expectMoney(summary.cardTotal, 728.42);
    expectMoney(summary.reimbursableTotal, 73);
  });

  it('mantém o "A receber" fora do gasto do mês e de todos os tópicos', () => {
    // 902,36 de custos fixos + 9,95 de imprevistos + 505,47 de Diversos + 110,00 de Conhecimento.
    expectMoney(summary.expenseTotal, 1527.78);
    expect(summary.topics.map((t) => t.spent)).toEqual([505.47, 0, 0, 110]);
  });

  it('não muda nada quando o "A receber" sai da jogada, a não ser a fatura', () => {
    const withoutReimbursable = openMonth();
    withoutReimbursable.expenses = withoutReimbursable.expenses.filter(
      (e) => e.categoryKind !== 'reimbursable',
    );
    const other = computeMonthSummary(withoutReimbursable);

    expect(other.topics).toEqual(summary.topics);
    expect(other.expenseTotal).toBe(summary.expenseTotal);
    expect(other.balance).toBe(summary.balance);
    expectMoney(other.cardTotal, 655.42);
    expect(other.reimbursableTotal).toBe(0);
  });
});
