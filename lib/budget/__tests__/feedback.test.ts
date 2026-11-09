import { describe, expect, it } from 'vitest';
import type { MonthSummary } from '../calculations';
import { DEFAULT_SPECIAL_CATEGORY_LABELS } from '../categories';
import { expenseFeedback as feedback } from '../feedback';

/** formatBRL puts a no-break space after "R$". */
const expenseFeedback = (input: Parameters<typeof feedback>[0]) => feedback(input).replace(/\u00a0/g, ' ');

const summary = {
  balance: 1000,
  topics: [{ topicId: 'diversos', name: 'Diversos', remaining: 365 }],
} as unknown as MonthSummary;
const base = { summary, labels: DEFAULT_SPECIAL_CATEGORY_LABELS, month: '2026-10', currentMonth: '2026-10' };

describe('retorno depois de lançar um gasto', () => {
  it('diz quanto ainda dá na categoria, ou quanto passou da meta', () => {
    expect(expenseFeedback({ ...base, expense: { categoryKind: 'topic', topicId: 'diversos', amount: 45 } })).toBe(
      'R$ 45,00 em Diversos · ainda dá R$ 320,00 este mês',
    );
    expect(expenseFeedback({ ...base, expense: { categoryKind: 'topic', topicId: 'diversos', amount: 395 } })).toBe(
      'R$ 395,00 em Diversos · passou R$ 30,00 da meta',
    );
    expect(
      expenseFeedback({ ...base, month: '2026-09', expense: { categoryKind: 'topic', topicId: 'diversos', amount: 45 } }),
    ).toBe('R$ 45,00 em Diversos · ainda dá R$ 320,00 em set/26');
  });

  it('custo fixo fala do total; A receber e Fora do orçamento não mexem em categoria', () => {
    expect(expenseFeedback({ ...base, expense: { categoryKind: 'fixedCost', amount: 100 } })).toMatch(
      /^R\$ 100,00 em .+ · ainda dá R\$ 900,00 este mês$/,
    );
    expect(expenseFeedback({ ...base, expense: { categoryKind: 'reimbursable', amount: 73 } })).toMatch(
      /não gasta nenhuma categoria$/,
    );
    expect(expenseFeedback({ ...base, expense: { categoryKind: 'uncounted', amount: 20 } })).toBe(
      'R$ 20,00 fora do orçamento',
    );
    expect(expenseFeedback({ ...base, summary: null, expense: { categoryKind: 'topic', amount: 20 } })).toBe(
      'Gasto de R$ 20,00 salvo.',
    );
  });
});
