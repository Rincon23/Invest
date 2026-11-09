import { describe, expect, it } from 'vitest';
import {
  computeCardTotal,
  computeMonthSummary,
  computeProgressState,
  computeRemaining,
  computeUsedPct,
} from '../calculations';
import { createMonthData } from '../rollover';
import type { Expense, MonthData, TopicConfig } from '../types';
import { validateTopicPercentages } from '../validation';

function findTopic(summary: ReturnType<typeof computeMonthSummary>, topicId: string) {
  const topic = summary.topics.find((t) => t.topicId === topicId);
  if (!topic) throw new Error(`topic ${topicId} not found in summary`);
  return topic;
}

const TOPICS: TopicConfig[] = [
  { id: 'diversos', name: 'Diversos', targetPct: 0.2, order: 0 },
  { id: 'liberdade', name: 'Liberdade Financeira', targetPct: 0.45, order: 1 },
  { id: 'metas', name: 'Metas', targetPct: 0.25, order: 2 },
  { id: 'conhecimento', name: 'Conhecimento', targetPct: 0.1, order: 3 },
];

function zeroCarryIn(): Record<string, number> {
  return Object.fromEntries(TOPICS.map((t) => [t.id, 0]));
}

const BASE_EXPENSES: Expense[] = [
  {
    id: 'e1',
    categoryKind: 'topic',
    topicId: 'diversos',
    description: 'Diversos',
    amount: 300,
    date: '2026-01-10',
  },
  {
    id: 'e2',
    categoryKind: 'topic',
    topicId: 'conhecimento',
    description: 'Conhecimento',
    amount: 110,
    date: '2026-01-10',
  },
  { id: 'e3', categoryKind: 'fixedCost', description: 'Custo Fixo', amount: 800, date: '2026-01-10' },
  { id: 'e4', categoryKind: 'unforeseen', description: 'Imprevistos', amount: 200, date: '2026-01-10' },
];

function buildMonth(overrides: Partial<MonthData> = {}): MonthData {
  return {
    month: '2026-01',
    incomes: [{ id: 'i1', source: 'Salário', amount: 5000 }],
    expenses: BASE_EXPENSES,
    carryIn: zeroCarryIn(),
    topicsSnapshot: TOPICS,
    ...overrides,
  };
}

describe('Cenário A — mês isolado, sem rollover', () => {
  const summary = computeMonthSummary(buildMonth());

  it('calcula proportionalFixed, available, remaining e usedPct de Diversos', () => {
    const diversos = findTopic(summary, 'diversos');
    expect(diversos.proportionalFixed).toBe(200);
    expect(diversos.available).toBe(800);
    expect(diversos.remaining).toBe(500);
    expect(diversos.usedPct).toBeCloseTo(0.375);
  });

  it('calcula available e remaining de Liberdade Financeira', () => {
    const liberdade = findTopic(summary, 'liberdade');
    expect(liberdade.available).toBe(1800);
    expect(liberdade.remaining).toBe(1800);
  });

  it('calcula available e remaining de Conhecimento', () => {
    const conhecimento = findTopic(summary, 'conhecimento');
    expect(conhecimento.available).toBe(400);
    expect(conhecimento.remaining).toBe(290);
  });
});

describe('Cenário B — com rollover', () => {
  const summary = computeMonthSummary(
    buildMonth({ carryIn: { ...zeroCarryIn(), diversos: 150, conhecimento: -40 } }),
  );

  it('soma o carryIn positivo de Diversos', () => {
    const diversos = findTopic(summary, 'diversos');
    expect(diversos.available).toBe(950);
    expect(diversos.remaining).toBe(650);
  });

  it('soma o carryIn negativo de Conhecimento', () => {
    const conhecimento = findTopic(summary, 'conhecimento');
    expect(conhecimento.available).toBe(360);
    expect(conhecimento.remaining).toBe(250);
  });
});

describe('Cenário C — fechamento e carga', () => {
  it('o carryIn do próximo mês é o remaining do mês fechado', () => {
    const monthB = buildMonth({ carryIn: { ...zeroCarryIn(), diversos: 150, conhecimento: -40 } });
    const summaryB = computeMonthSummary(monthB);

    const monthC = createMonthData('2026-02', TOPICS, summaryB);

    expect(monthC.carryIn.diversos).toBe(650);
    expect(monthC.carryIn.conhecimento).toBe(250);
    expect(monthC.carryIn.liberdade).toBe(summaryB.topics.find((t) => t.topicId === 'liberdade')?.remaining);
    expect(monthC.incomes).toEqual([]);
    expect(monthC.expenses).toEqual([]);
  });
});

describe('Cenário D — gasto no cartão', () => {
  it('computeCardTotal soma só as compras marcadas como cartão', () => {
    const expenses: Expense[] = [
      {
        id: 'a',
        categoryKind: 'topic',
        topicId: 'diversos',
        description: 'Cartão',
        amount: 300,
        date: '2026-01-10',
        singleInstallmentCard: true,
      },
      {
        id: 'b',
        categoryKind: 'topic',
        topicId: 'metas',
        description: 'À vista',
        amount: 50,
        date: '2026-01-10',
      },
    ];
    expect(computeCardTotal(expenses)).toBe(300);
  });
});

describe('Cenário E — validação de config', () => {
  it('bloqueia quando a soma dos percentuais é 95%', () => {
    const invalidTopics: TopicConfig[] = [
      { id: 'a', name: 'A', targetPct: 0.2, order: 0 },
      { id: 'b', name: 'B', targetPct: 0.45, order: 1 },
      { id: 'c', name: 'C', targetPct: 0.2, order: 2 },
      { id: 'd', name: 'D', targetPct: 0.1, order: 3 },
    ];
    const result = validateTopicPercentages(invalidTopics);
    expect(result.valid).toBe(false);
    expect(result.diffPct).toBeCloseTo(0.05);
  });

  it('aceita quando a soma é exatamente 100%', () => {
    expect(validateTopicPercentages(TOPICS).valid).toBe(true);
  });
});

describe('Cenário F — available <= 0', () => {
  it('usedPct é null e remaining é negativo do gasto', () => {
    expect(computeUsedPct(50, 0)).toBeNull();
    expect(computeUsedPct(50, -10)).toBeNull();
    expect(computeRemaining(0, 50)).toBe(-50);
  });

  it('o estado do card fica em alerta (danger)', () => {
    expect(computeProgressState(null)).toBe('danger');
  });

  it('reflete no resumo do mês quando o rateio consome toda a renda da categoria', () => {
    const month = buildMonth({
      expenses: [
        {
          id: 'e1',
          categoryKind: 'topic',
          topicId: 'conhecimento',
          description: 'Curso',
          amount: 50,
          date: '2026-01-10',
        },
        { id: 'e2', categoryKind: 'fixedCost', description: 'Aluguel', amount: 5000, date: '2026-01-10' },
      ],
    });
    const summary = computeMonthSummary(month);
    const conhecimento = findTopic(summary, 'conhecimento');
    expect(conhecimento.available).toBeLessThanOrEqual(0);
    expect(conhecimento.usedPct).toBeNull();
  });
});

describe('Progress state thresholds', () => {
  it('ok abaixo de 80%', () => {
    expect(computeProgressState(0.5)).toBe('ok');
  });
  it('warning entre 80% e 100%', () => {
    expect(computeProgressState(0.8)).toBe('warning');
    expect(computeProgressState(1)).toBe('warning');
  });
  it('danger acima de 100%', () => {
    expect(computeProgressState(1.01)).toBe('danger');
  });
});

describe('Renda para uma categoria só', () => {
  const month = buildMonth({
    expenses: [],
    incomes: [
      { id: 'i1', source: 'Salário', amount: 5000 },
      { id: 'i2', source: 'Presente para a viagem', amount: 1000, topicId: 'metas' },
    ],
  });
  const summary = computeMonthSummary(month);

  it('entra no total de renda do mês', () => {
    expect(summary.incomeTotal).toBe(6000);
  });

  it('vai inteira para a categoria escolhida, sem passar pelas %', () => {
    const metas = findTopic(summary, 'metas');
    expect(metas.incomeShare).toBe(1250);
    expect(metas.directIncome).toBe(1000);
    expect(metas.available).toBe(2250);
  });

  it('as outras categorias recebem só a renda dividida', () => {
    expect(findTopic(summary, 'diversos').available).toBe(1000);
    expect(findTopic(summary, 'diversos').directIncome).toBe(0);
  });

  it('a soma do que dá para gastar continua igual à renda', () => {
    expect(summary.availableTotal).toBe(6000);
  });

  it('a categoria que já não está no mês faz a renda voltar a ser dividida', () => {
    const orphan = computeMonthSummary(
      buildMonth({
        expenses: [],
        incomes: [{ id: 'i1', source: 'Salário', amount: 5000, topicId: 'sumiu' }],
      }),
    );
    expect(findTopic(orphan, 'diversos').available).toBe(1000);
    expect(orphan.availableTotal).toBe(5000);
  });
});
