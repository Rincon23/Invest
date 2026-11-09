import { describe, expect, it } from 'vitest';
import { computeMonthSummary } from '../calculations';
import { installmentExpense, upfrontExpense } from '../installments';
import { cascadeCarryIn } from '../rollover';
import {
  TAG_COLORS,
  TAG_LIMITS,
  cleanTagIds,
  createTag,
  expenseMatches,
  incomeMatches,
  nextTagColor,
  sanitizeTags,
  tagColor,
  tagNameProblem,
} from '../tags';
import { createDefaultTopics } from '../topics';
import type { Expense, Income, InstallmentPlan, MonthData, Tag } from '../types';

const topics = createDefaultTopics();
const [main, investments] = topics;

const tag = (id: string, name: string, kind: Tag['kind'] = 'expense', order = 0): Tag => ({
  id,
  name,
  kind,
  order,
});
const tags: Tag[] = [
  tag('mercado', 'Mercado', 'expense', 0),
  tag('restaurante', 'Restaurante', 'expense', 1),
  tag('viagem', 'Viagem', 'expense', 2),
  tag('bico', 'Bico', 'income', 0),
];

const expense = (id: string, overrides: Partial<Expense> = {}): Expense => ({
  id,
  categoryKind: 'topic',
  topicId: main.id,
  description: id,
  amount: 10,
  date: '2026-03-10',
  ...overrides,
});

describe('tag não muda nenhum número', () => {
  const month = (withTags: boolean, key: string, closed: boolean): MonthData => {
    const tagged = (ids: string[]) => (withTags ? { tagIds: ids } : {});
    return {
      month: key,
      incomes: [
        { id: `${key}-sal`, source: 'Salário', amount: 3000, ...tagged(['bico']) },
        { id: `${key}-bico`, source: 'Bico', amount: 500, topicId: investments.id, ...tagged(['bico']) },
      ],
      expenses: [
        expense(`${key}-feira`, { amount: 230.4, ...tagged(['mercado']) }),
        expense(`${key}-jantar`, { amount: 120, ...tagged(['restaurante', 'viagem']) }),
        expense(`${key}-aluguel`, {
          categoryKind: 'fixedCost',
          topicId: undefined,
          amount: 1200,
          ...tagged(['mercado']),
        }),
        expense(`${key}-conserto`, { categoryKind: 'unforeseen', topicId: undefined, amount: 90 }),
        expense(`${key}-amigo`, {
          categoryKind: 'reimbursable',
          topicId: undefined,
          amount: 60,
          singleInstallmentCard: true,
          ...tagged(['viagem']),
        }),
        expense(`${key}-fora`, {
          categoryKind: 'uncounted',
          topicId: undefined,
          amount: 40,
          ...tagged(['mercado']),
        }),
        expense(`${key}-curso`, {
          topicId: topics[3].id,
          amount: 300,
          singleInstallmentCard: true,
          ...tagged(['viagem']),
        }),
      ],
      carryIn: Object.fromEntries(topics.map((t) => [t.id, 0])),
      topicsSnapshot: topics,
      closed,
    };
  };

  it('o mesmo mês com e sem tags dá exatamente os mesmos totais', () => {
    const without = computeMonthSummary(month(false, '2026-03', false), topics);
    const withTags = computeMonthSummary(month(true, '2026-03', false), topics);
    expect(withTags).toEqual(without);
  });

  it('e a sobra que passa para o mês seguinte também é a mesma', () => {
    const chain = (withTags: boolean) =>
      cascadeCarryIn([month(withTags, '2026-03', true), month(withTags, '2026-04', false)], (data) =>
        computeMonthSummary(data, topics),
      ).map((data) => data.carryIn);
    expect(chain(true)).toEqual(chain(false));
  });
});

describe('nome de tag', () => {
  it('não pode ser vazio, longo demais, repetido nem nome de categoria', () => {
    expect(tagNameProblem('  ', 'expense', tags)).toMatch(/nome/);
    expect(tagNameProblem('x'.repeat(TAG_LIMITS.name + 1), 'expense', tags)).toMatch(/até/);
    expect(tagNameProblem(' mércado ', 'expense', tags)).toBe('Já existe uma tag com esse nome.');
    expect(tagNameProblem('Metas', 'expense', tags, topics)).toMatch(/categoria/);
    expect(tagNameProblem('prazeres e confortos', 'income', tags, topics)).toMatch(/categoria/);
  });

  it('a mesma palavra pode existir em gasto e em renda, e renomear para o próprio nome pode', () => {
    expect(tagNameProblem('Mercado', 'income', tags, topics)).toBeNull();
    expect(tagNameProblem('MERCADO', 'expense', tags, topics, 'mercado')).toBeNull();
  });

  it('cada tipo tem um teto de tags', () => {
    const many = Array.from({ length: TAG_LIMITS.perKind }, (_, i) => tag(`t${i}`, `Tag ${i}`, 'expense', i));
    expect(tagNameProblem('Mais uma', 'expense', many)).toMatch(/até/);
    expect(tagNameProblem('Mais uma', 'income', many)).toBeNull();
  });

  it('uma tag nova vai para o fim da lista do seu tipo', () => {
    expect(createTag('  Pet   shop ', 'expense', tags)).toMatchObject({
      name: 'Pet shop',
      kind: 'expense',
      order: 3,
    });
    expect(createTag('Freela', 'income', tags).order).toBe(1);
  });

  it('uma tag nova nasce com a cor escolhida, ou com a próxima livre da paleta', () => {
    expect(createTag('Pet', 'expense', tags, '#123456').color).toBe('#123456');
    // Mercado, Restaurante e Viagem (sem cor) ficam com as 3 primeiras pela posição.
    expect(createTag('Pet', 'expense', tags).color).toBe(TAG_COLORS[3]);
    expect(createTag('Freela', 'income', tags).color).toBe(TAG_COLORS[1]);
    expect(nextTagColor([], 'expense')).toBe(TAG_COLORS[0]);
    const colored = [
      { ...tags[0], color: TAG_COLORS[0] },
      { ...tags[1], color: '#abcdef' },
    ];
    expect(nextTagColor(colored, 'expense')).toBe(TAG_COLORS[1]);
  });

  it('toda tag tem uma cor de bolinha, até as de antes da escolha de cor', () => {
    expect(tagColor({ color: '#00aa00', order: 5 })).toBe('#00aa00');
    expect(tagColor({ order: 2 })).toBe(TAG_COLORS[2]);
    expect(tagColor({ order: TAG_COLORS.length })).toBe(TAG_COLORS[0]);
  });
});

describe('o que o servidor guarda', () => {
  it('limpa as tags: sem vazias, repetidas ou com nome de categoria', () => {
    const kept = sanitizeTags(
      [
        tag('a', ' Mercado ', 'expense', 0),
        tag('b', 'mercado', 'expense', 1),
        tag('c', '', 'expense', 2),
        tag('d', 'Metas', 'expense', 3),
        tag('e', 'Mercado', 'income', 0),
        tag('a', 'Repetida', 'income', 5),
      ],
      topics,
    );
    expect(kept.map((t) => [t.id, t.name, t.kind])).toEqual([
      ['a', 'Mercado', 'expense'],
      ['e', 'Mercado', 'income'],
    ]);
  });

  it('um lançamento só guarda tags que existem, do tipo dele, uma vez e até o teto', () => {
    const valid = new Set(['mercado', 'restaurante', 'viagem']);
    expect(cleanTagIds(['mercado', 'bico', 'mercado', 'sumiu', 'viagem'], valid)).toEqual([
      'mercado',
      'viagem',
    ]);
    const lots = new Set(Array.from({ length: 20 }, (_, i) => `t${i}`));
    expect(cleanTagIds([...lots], lots)).toHaveLength(TAG_LIMITS.perEntry);
    expect(cleanTagIds(undefined, valid)).toEqual([]);
  });
});

describe('filtro de Lançamentos', () => {
  const list = [
    expense('feira', { tagIds: ['mercado'], amount: 100 }),
    expense('padaria', { tagIds: ['mercado'], amount: 30, categoryKind: 'unforeseen', topicId: undefined }),
    expense('jantar', { tagIds: ['restaurante'], amount: 80 }),
    expense('hotel', { tagIds: ['viagem'], amount: 400, topicId: topics[2].id }),
    expense('cinema', { amount: 25 }),
  ];
  const shown = (filter: Parameters<typeof expenseMatches>[1]) =>
    list.filter((e) => expenseMatches(e, filter)).map((e) => e.id);

  it('sem nada escolhido mostra tudo', () => {
    expect(shown({ tagIds: [], search: '' })).toEqual(list.map((e) => e.id));
  });

  it('dentro das tags é "ou", e o total é o do mercado', () => {
    expect(shown({ tagIds: ['mercado'], search: '' })).toEqual(['feira', 'padaria']);
    const total = list
      .filter((e) => expenseMatches(e, { tagIds: ['mercado'], search: '' }))
      .reduce((s, e) => s + e.amount, 0);
    expect(total).toBe(130);
    expect(shown({ tagIds: ['mercado', 'viagem'], search: '' })).toEqual(['feira', 'padaria', 'hotel']);
  });

  it('entre categorias e tags é "e"', () => {
    expect(shown({ categories: [`topic:${main.id}`], tagIds: ['mercado'], search: '' })).toEqual(['feira']);
    expect(shown({ categories: [`topic:${main.id}`], tagIds: ['restaurante'], search: '' })).toEqual([
      'jantar',
    ]);
  });

  it('a busca acha pelo nome da tag também', () => {
    expect(shown({ tagIds: [], search: 'restaur', tags })).toEqual(['jantar']);
    expect(shown({ tagIds: [], search: 'cine', tags })).toEqual(['cinema']);
  });

  it('a renda filtra pelas tags dela', () => {
    const incomes: Income[] = [
      { id: 'sal', source: 'Salário', amount: 3000 },
      { id: 'pintura', source: 'Pintura', amount: 300, tagIds: ['bico'] },
    ];
    expect(
      incomes.filter((i) => incomeMatches(i, { tagIds: ['bico'], search: '' })).map((i) => i.id),
    ).toEqual(['pintura']);
    expect(
      incomes.filter((i) => incomeMatches(i, { tagIds: [], search: 'bico', tags })).map((i) => i.id),
    ).toEqual(['pintura']);
  });
});

describe('parcelamento', () => {
  const plan: InstallmentPlan = {
    id: 'tv',
    name: 'TV',
    categoryKind: 'topic',
    topicId: main.id,
    firstDebitDate: '2026-03-10',
    count: 3,
    totalAmount: 300,
    accounting: 'installment',
    tagIds: ['casa'],
  };

  it('cada parcela e o gasto à vista nascem com as tags da compra', () => {
    expect(installmentExpense(plan, 2, '2026-04-10').tagIds).toEqual(['casa']);
    expect(upfrontExpense({ ...plan, accounting: 'upfront' }).tagIds).toEqual(['casa']);
    expect(installmentExpense({ ...plan, tagIds: undefined }, 1, '2026-03-10').tagIds).toBeUndefined();
  });
});
