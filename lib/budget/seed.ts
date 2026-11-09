import { DEFAULT_SPECIAL_CATEGORY_LABELS } from './categories';
import { DEFAULT_SPECIAL_CATEGORY_COLORS } from './colors';
import { createId } from './id';
import { createDefaultTopics } from './topics';
import type { BudgetSettings, Month, MonthData, TopicConfig } from './types';

export function createDefaultSettings(): BudgetSettings {
  return {
    topics: createDefaultTopics(),
    specialCategories: { ...DEFAULT_SPECIAL_CATEGORY_LABELS },
    specialCategoryColors: { ...DEFAULT_SPECIAL_CATEGORY_COLORS },
    // Every optional module starts off: a new account is the budgeting app and nothing else.
    modules: {},
  };
}

/** Demo data for the first run, per the product spec's seed scenario. */
export function createSeedMonthData(month: Month, topics: TopicConfig[]): MonthData {
  const diversos = topics.find((t) => t.preset === 'diversos');
  const conhecimento = topics.find((t) => t.preset === 'conhecimentos');

  return {
    month,
    incomes: [{ id: createId(), source: 'Salário', amount: 5000, date: `${month}-05` }],
    expenses: [
      {
        id: createId(),
        categoryKind: 'topic',
        topicId: diversos?.id,
        description: 'Almoço shopping',
        amount: 144.8,
        date: `${month}-03`,
      },
      {
        id: createId(),
        categoryKind: 'topic',
        topicId: conhecimento?.id,
        description: 'Cloud AI',
        amount: 110,
        date: `${month}-04`,
      },
      {
        id: createId(),
        categoryKind: 'fixedCost',
        description: 'Gasolina',
        amount: 30,
        date: `${month}-02`,
      },
      {
        id: createId(),
        categoryKind: 'fixedCost',
        description: 'Faculdade',
        amount: 872.36,
        date: `${month}-05`,
      },
      {
        id: createId(),
        categoryKind: 'unforeseen',
        description: 'Estacionamento',
        amount: 9.95,
        date: `${month}-06`,
      },
    ],
    carryIn: Object.fromEntries(topics.map((t) => [t.id, 0])),
    topicsSnapshot: topics,
  };
}
