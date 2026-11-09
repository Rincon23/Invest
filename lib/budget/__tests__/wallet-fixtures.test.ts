import { describe, expect, it } from 'vitest';
import { computeCashReport } from '../cash';
import {
  addMonthsClamped,
  installmentAmount,
  installmentDebt,
  installmentEndDate,
  installmentExpense,
  installmentsDueIn,
  isInstallmentFinished,
  remainingInstallments,
  sortInstallments,
} from '../installments';
import { freeReserveQuotas, quotasForAmount, summarizeInvestments } from '../investments';
import type { InstallmentPlan, InvestmentBucket } from '../types';

/**
 * The parcelados and caixa fixtures of §9 of the bot spec, taken from the real spreadsheet on
 * 15/09/2026. The spreadsheet's own numbers for the first seven plans are stale (they were typed
 * in, not calculated — correction 15), so the expectations here are the recalculated ones the
 * spec asks for. Tolerance of R$ 0,01, as in the budget fixtures.
 */
const TODAY = '2026-09-15';
const MONTH = '2026-09';
const TOLERANCE = 0.01;

function expectMoney(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE + 1e-9);
}

function plan(
  id: string,
  name: string,
  firstDebitDate: string,
  count: number,
  totalAmount: number,
): InstallmentPlan {
  return {
    id,
    name,
    categoryKind: 'fixedCost',
    firstDebitDate,
    count,
    totalAmount,
    accounting: 'installment',
  };
}

/** The eight plans in the spreadsheet on 15/09/2026. */
const PLANS: InstallmentPlan[] = [
  plan('p1', 'Faculdade', '2025-12-09', 10, 872.36),
  plan('p2', 'Faculdade', '2026-03-09', 10, 872.36),
  plan('p3', 'Faculdade', '2026-04-09', 10, 872.36),
  plan('p4', 'Faculdade', '2026-05-09', 10, 872.36),
  plan('p5', 'Faculdade', '2026-06-09', 10, 872.36),
  plan('p6', 'Faculdade', '2026-07-09', 10, 872.36),
  plan('p7', 'Amazon Prime', '2026-06-09', 12, 166.8),
  plan('p8', 'Faculdade', '2026-09-04', 10, 890.11),
];

describe('datas dos parcelados', () => {
  it('anda de mês em mês sem estourar para o mês seguinte', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonthsClamped('2026-09-04', 9)).toBe('2027-06-04');
    expect(addMonthsClamped('2026-12-09', -1)).toBe('2026-11-09');
  });
});

describe('parcelados da planilha em 15/09/2026 (fixtures da spec §9)', () => {
  it.each([
    ['p1', 87.236, 0],
    ['p2', 87.236, 3],
    ['p3', 87.236, 4],
    ['p4', 87.236, 5],
    ['p5', 87.236, 6],
    ['p6', 87.236, 7],
    ['p7', 13.9, 8],
    ['p8', 89.011, 9],
  ])('%s: parcela e parcelas restantes', (id, amount, remaining) => {
    const found = PLANS.find((p) => p.id === id)!;
    expectMoney(installmentAmount(found), amount);
    expect(remainingInstallments(found, TODAY)).toBe(remaining);
  });

  it('marca como encerrado só o parcelamento que acabou', () => {
    // A Faculdade de 09/12/2025 terminou em 09/09/2026; na planilha ela continua lá.
    expect(isInstallmentFinished(PLANS[0], TODAY)).toBe(true);
    expect(PLANS.slice(1).every((p) => !isInstallmentFinished(p, TODAY))).toBe(true);
  });

  it('calcula o fim pelo último vencimento', () => {
    expect(installmentEndDate(PLANS[7])).toBe('2027-06-04');
    expect(installmentEndDate(PLANS[0])).toBe('2026-09-09');
  });

  it('ordena a lista pelas parcelas restantes, como o bot', () => {
    expect(sortInstallments(PLANS, TODAY).map((p) => p.id)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
      'p6',
      'p7',
      'p8',
    ]);
  });

  it('fecha a dívida dos parcelados em −3.093,20', () => {
    expectMoney(installmentDebt(PLANS, MONTH), -3093.2);
  });

  it('não conta a parcela da competência corrente: ela já está na fatura do mês', () => {
    // Vence dia 20, ainda à frente de hoje, mas dentro de setembro: é fatura, não dívida futura.
    const sofa = plan('x', 'Sofá', '2026-09-20', 2, 200);
    expectMoney(installmentDebt([sofa], MONTH), -100);
  });
});

describe('parcelas viram gasto no mês do vencimento', () => {
  it('encontra a parcela da competência e a lança no cartão', () => {
    const due = installmentsDueIn(PLANS, '2026-10');
    expect(due.map((d) => `${d.plan.id}:${d.number}`).sort()).toEqual([
      'p2:8',
      'p3:7',
      'p4:6',
      'p5:5',
      'p6:4',
      'p7:5',
      'p8:2',
    ]);

    const expense = installmentExpense(PLANS[7], 2, '2026-10-04');
    expect(expense).toMatchObject({
      id: 'p8:2',
      description: 'Faculdade 2/10',
      amount: 89.01,
      date: '2026-10-04',
      singleInstallmentCard: true,
      source: 'installment',
      installmentId: 'p8',
      installmentNumber: 2,
    });
  });

  it('ignora os parcelamentos contabilizados à vista', () => {
    const upfront: InstallmentPlan = { ...PLANS[1], id: 'u1', accounting: 'upfront' };
    expect(installmentsDueIn([upfront], '2026-10')).toEqual([]);
  });
});

describe('reserva investida e caixa em 15/09/2026 (fixtures da spec §9)', () => {
  const PRICE = 110.24;
  const BUCKETS: InvestmentBucket[] = [
    { id: 'b1', name: 'Metas', topicId: 'metas', quotas: 49.29754824469445 },
    { id: 'b2', name: 'Conhecimento', topicId: 'conhecimento', quotas: 15.264317071781342 },
  ];
  const summary = summarizeInvestments(
    { ticker: 'AUPO11', totalQuotas: 228 },
    BUCKETS,
    { ticker: 'AUPO11', price: PRICE, fetchedAt: '2026-09-15T13:00:00.000Z' },
    new Date('2026-09-15T13:30:00.000Z'),
  );

  it('divide as cotas entre a reserva livre e as categorias da reserva', () => {
    expect(freeReserveQuotas({ totalQuotas: 228 }, BUCKETS)).toBeCloseTo(163.4381, 4);
    expectMoney(summary.freeValue, 18017.42);
    expectMoney(summary.buckets[0].value, 5434.56);
    expectMoney(summary.buckets[1].value, 1682.74);
  });

  it('converte um valor em reais para cotas fracionárias', () => {
    expect(quotasForAmount(1102.4, PRICE)).toBeCloseTo(10, 10);
    expect(quotasForAmount(100, 0)).toBe(0);
  });

  it('fecha o relatório do caixa da planilha', () => {
    const report = computeCashReport({
      settings: {
        reserveAccountAmount: 1000,
        emergencyCosts: [
          { label: 'Faculdade', amount: 500 },
          { label: 'Contas', amount: 900 },
          { label: 'Gasolina', amount: 200 },
          { label: 'Gastos diversos', amount: 400 },
        ],
        reserveMultiplier: 6,
      },
      investedReserve: summary.freeValue,
      cardDebt: -728.42,
      installmentDebt: installmentDebt(PLANS, TODAY),
      cardMonth: '2026-09',
    });

    expectMoney(report.totalReserve, 19017.42);
    expectMoney(report.totalDebt, -3821.62);
    expectMoney(report.monthlyCost, 2000);
    expectMoney(report.expectedReserve, 12000);
    expectMoney(report.gap, 3195.8);
  });
});
