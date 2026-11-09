import { describe, expect, it } from 'vitest';
import { computeMonthSummary, computeReimbursablePendingTotal } from '../calculations';
import {
  reserveMonthlyAmount,
  reservePlanProblem,
  summarizeReservePlan,
  type ReserveContribution,
  type ReservePlan,
} from '../reserve';
import type { Expense, MonthData, TopicConfig } from '../types';

/**
 * O plano da reserva é todo calculado a partir do que foi lançado, nunca de um contador guardado:
 * é o que faz pular um mês adiar o plano em vez de quebrá-lo, e o que faz a conta continuar certa
 * quando a pessoa lança meia parcela ou duas no mesmo mês.
 */

const PLAN: ReservePlan = {
  targetAmount: 5000,
  months: 10,
  startMonth: '2026-09',
  reason: 'Cirurgia',
};

function contribution(month: string, amount: number, id = `${month}:${amount}`): ReserveContribution {
  return { id, month, amount, date: `${month}-10` };
}

describe('o plano de recompor a reserva', () => {
  it('divide o rombo pelos meses', () => {
    expect(reserveMonthlyAmount(PLAN)).toBe(500);
    expect(reserveMonthlyAmount({ targetAmount: 1000, months: 3 })).toBe(333.33);
    expect(reserveMonthlyAmount({ targetAmount: 1000, months: 0 })).toBe(0);
  });

  it('conta o que já voltou, o que falta e quantos meses ainda faltam nesse ritmo', () => {
    const summary = summarizeReservePlan(
      PLAN,
      [contribution('2026-09', 500), contribution('2026-10', 500)],
      '2026-10',
    );
    expect(summary.contributed).toBe(1000);
    expect(summary.remaining).toBe(4000);
    expect(summary.contributedThisMonth).toBe(500);
    expect(summary.monthsLeft).toBe(8);
    expect(summary.progress).toBeCloseTo(0.2, 8);
    expect(summary.done).toBe(false);
  });

  it('soma duas parcelas no mesmo mês, e pular um mês só adia', () => {
    const summary = summarizeReservePlan(
      PLAN,
      [contribution('2026-09', 300, 'a'), contribution('2026-09', 200, 'b')],
      '2026-09',
    );
    expect(summary.contributedThisMonth).toBe(500);
    // Um mês sem nada não muda a conta: continuam faltando 9 parcelas de 500.
    expect(summarizeReservePlan(PLAN, [contribution('2026-09', 500)], '2026-11').monthsLeft).toBe(9);
  });

  it('fecha o plano quando a reserva recebeu tudo, mesmo com centavos sobrando', () => {
    const plan: ReservePlan = { targetAmount: 1000, months: 3, startMonth: '2026-09' };
    const parcels = [
      contribution('2026-09', 333.33, 'a'),
      contribution('2026-10', 333.33, 'b'),
      contribution('2026-11', 333.34, 'c'),
    ];
    const summary = summarizeReservePlan(plan, parcels, '2026-11');
    expect(summary.done).toBe(true);
    expect(summary.remaining).toBe(0);
    expect(summary.monthsLeft).toBe(0);
  });

  it('recusa um plano sem valor ou com meses fora da conta', () => {
    expect(reservePlanProblem(PLAN)).toBeNull();
    expect(reservePlanProblem({ targetAmount: 0, months: 10 })).toContain('maior que zero');
    expect(reservePlanProblem({ targetAmount: 100, months: 0 })).toContain('1 a 120');
    expect(reservePlanProblem({ targetAmount: 100, months: 2.5 })).toContain('1 a 120');
  });
});

describe('"A receber" com quem já pagou', () => {
  const topics: TopicConfig[] = [
    { id: 't1', name: 'Diversos', targetPct: 1, order: 0, color: '#2a78d6' },
  ];

  function reimbursable(id: string, amount: number, reimbursedAt?: string): Expense {
    return {
      id,
      categoryKind: 'reimbursable',
      description: `Almoço ${id}`,
      amount,
      date: '2026-09-10',
      singleInstallmentCard: true,
      ...(reimbursedAt ? { reimbursedAt } : {}),
    };
  }

  it('separa o que ainda devem do que já foi pago, sem mexer no orçamento', () => {
    const expenses = [
      reimbursable('a', 100),
      reimbursable('b', 50, '2026-09-20T12:00:00.000Z'),
    ];
    expect(computeReimbursablePendingTotal(expenses)).toBe(100);

    const data: MonthData = {
      month: '2026-09',
      incomes: [{ id: 'i1', source: 'Salário', amount: 1000 }],
      expenses,
      carryIn: {},
      topicsSnapshot: topics,
    };
    const summary = computeMonthSummary(data, topics);
    // A marca é só controle: a fatura e o orçamento continuam exatamente iguais.
    expect(summary.reimbursableTotal).toBe(150);
    expect(summary.reimbursablePendingTotal).toBe(100);
    expect(summary.cardTotal).toBe(150);
    expect(summary.expenseTotal).toBe(0);
    expect(summary.topics[0].spent).toBe(0);
  });
});
