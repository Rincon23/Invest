import { describe, expect, it } from 'vitest';
import { computeMonthSummary } from '../calculations';
import { DEFAULT_TOPIC_COLORS } from '../colors';
import { currentMonthKey, nextMonth, previousMonth } from '../date';
import {
  DEFAULT_TOPICS,
  consolidateBudgetData,
  consolidateMonthTopics,
  consolidateTopics,
  createDefaultTopics,
  enforceFixedTopics,
  hasDefaultTargets,
  normalizeTopic,
  topicDescription,
  withDefaultTargets,
} from '../topics';
import type { BudgetSettings, Expense, MonthData, TopicConfig } from '../types';
import { validateTopicPercentages } from '../validation';

const created = (id: string, order: number, targetPct = 0.1): TopicConfig => ({
  id,
  name: `Criada ${id}`,
  description: 'Minha categoria',
  targetPct,
  order,
});

const ids = (topics: TopicConfig[]) => topics.map((t) => t.id);

describe('categorias padrão', () => {
  it('nascem com a descrição de para que servem, fechando 100%', () => {
    const topics = createDefaultTopics();
    expect(topics.map((t) => t.name)).toEqual([
      'Prazeres e Confortos',
      'Investimentos',
      'Metas',
      'Conhecimentos',
    ]);
    expect(topics[0].preset).toBe('diversos');
    expect(topics.every((t) => t.preset && topicDescription(t).length > 0)).toBe(true);
    expect(validateTopicPercentages(topics).valid).toBe(true);
    expect(hasDefaultTargets(topics)).toBe(true);
  });

  it('explica uma categoria de dados antigos (sem preset nem descrição) pelo nome', () => {
    const legacy: TopicConfig = { id: 'x', name: 'Metas', targetPct: 0.25, order: 2 };
    expect(topicDescription(legacy)).toBe(DEFAULT_TOPICS[2].description);
    expect(normalizeTopic(legacy)).toMatchObject({
      preset: 'metas',
      description: DEFAULT_TOPICS[2].description,
    });
  });

  it('reconhece "Diversos" de dados antigos como Prazeres e Confortos', () => {
    const legacy: TopicConfig = { id: 'x', name: 'Diversos', targetPct: 0.2, order: 0 };
    expect(normalizeTopic(legacy).preset).toBe('diversos');
  });

  it('respeita a descrição escrita pela pessoa, mesmo vazia', () => {
    const [diversos] = createDefaultTopics();
    expect(topicDescription({ ...diversos, description: 'Lazer' })).toBe('Lazer');
    expect(topicDescription({ ...diversos, description: '' })).toBe('');
    expect(topicDescription(created('a', 4))).toBe('Minha categoria');
  });
});

describe('as quatro categorias fixas', () => {
  it('saem sempre as quatro, mantendo id, % e cor, mesmo com nome, descrição e ordem trocados', () => {
    const defaults = createDefaultTopics();
    const edited: TopicConfig[] = [
      { ...defaults[3], order: 0, name: 'Estudo', description: 'Meu texto', targetPct: 0.3 },
      { ...defaults[0], order: 1, name: 'Lazer', color: '#000000', targetPct: 0.1 },
      { ...defaults[1], order: 2, archived: true, targetPct: 0.4 },
      { ...defaults[2], order: 3 },
    ];
    const { topics, moved } = consolidateTopics(edited);

    expect(ids(topics)).toEqual(ids(defaults));
    expect(topics.map((t) => t.name)).toEqual(DEFAULT_TOPICS.map((t) => t.name));
    expect(topics.map((t) => t.description)).toEqual(DEFAULT_TOPICS.map((t) => t.description));
    expect(topics.map((t) => t.order)).toEqual([0, 1, 2, 3]);
    expect(topics.every((t) => !t.archived)).toBe(true);
    // A default that was archived comes back with 0%: it was getting nothing.
    expect(topics.map((t) => t.targetPct)).toEqual([0.1, 0, 0.25, 0.3]);
    expect(topics[0].color).toBe('#000000');
    expect(moved).toEqual({});
  });

  it('junta uma criada pela pessoa a Prazeres e Confortos, com a % dela', () => {
    const defaults = createDefaultTopics();
    const { topics, moved } = consolidateTopics([
      { ...defaults[0], targetPct: 0.1 },
      defaults[1],
      defaults[2],
      defaults[3],
      created('pets', 4, 0.1),
      { ...created('velha', 5, 0.5), archived: true },
    ]);
    expect(ids(topics)).toEqual(ids(defaults));
    expect(topics[0].targetPct).toBe(0.2);
    expect(validateTopicPercentages(topics).valid).toBe(true);
    expect(moved).toEqual({ pets: defaults[0].id, velha: defaults[0].id });
  });

  it('reconhece as padrão de dados antigos pelo nome e recria a que faltar, com 0%', () => {
    const legacy: TopicConfig[] = [
      { id: 'd', name: 'Diversos', targetPct: 0.5, order: 0 },
      { id: 'i', name: 'Investimentos', targetPct: 0.5, order: 1 },
    ];
    const { topics } = consolidateTopics(legacy);
    expect(topics.map((t) => t.name)).toEqual(DEFAULT_TOPICS.map((t) => t.name));
    expect(ids(topics).slice(0, 2)).toEqual(['d', 'i']);
    expect(topics.slice(2).map((t) => t.targetPct)).toEqual([0, 0]);
    expect(validateTopicPercentages(topics).valid).toBe(true);
  });

  it('não confunde uma criada com o mesmo nome de uma padrão que ainda existe', () => {
    const defaults = createDefaultTopics();
    const twin = { ...created('twin', 4), name: 'Metas' };
    const { topics, moved } = consolidateTopics([...defaults, twin]);
    expect(ids(topics)).toEqual(ids(defaults));
    expect(moved).toEqual({ twin: defaults[0].id });
  });

  it('uma conta sem categorias nasce com as quatro padrão', () => {
    const { topics } = consolidateTopics([]);
    expect(hasDefaultTargets(topics)).toBe(true);
  });

  it('ao salvar, aceita só a % e a cor do que veio', () => {
    const current = createDefaultTopics();
    const sent: TopicConfig[] = [
      {
        ...current[0],
        name: 'Lazer',
        description: 'Outra',
        targetPct: 0.3,
        color: '#123456',
        archived: true,
      },
      { ...current[1], targetPct: 0.35, order: 9 },
      current[2],
      { id: 'nova', name: 'Pets', targetPct: 0.1, order: 4 },
    ];
    const saved = enforceFixedTopics(current, sent);
    expect(ids(saved)).toEqual(ids(current));
    expect(saved.map((t) => t.name)).toEqual(DEFAULT_TOPICS.map((t) => t.name));
    expect(saved.every((t) => !t.archived)).toBe(true);
    expect(saved[0]).toMatchObject({
      targetPct: 0.3,
      color: '#123456',
      description: DEFAULT_TOPICS[0].description,
    });
    expect(saved[1]).toMatchObject({ targetPct: 0.35, order: 1 });
    // Left out of what was sent: it stays as it was.
    expect(saved[3]).toEqual(current[3]);
  });

  it('"Voltar às % padrão" devolve as % e as cores, sem trocar os ids', () => {
    const current = createDefaultTopics().map((t, i) => ({
      ...t,
      targetPct: i === 0 ? 1 : 0,
      color: '#000000',
    }));
    expect(hasDefaultTargets(current)).toBe(false);
    const restored = withDefaultTargets(current);
    expect(ids(restored)).toEqual(ids(current));
    expect(hasDefaultTargets(restored)).toBe(true);
    expect(restored.map((t) => t.color)).toEqual([...DEFAULT_TOPIC_COLORS.slice(0, 4)]);
  });
});

describe('um mês com uma categoria que deixou de existir', () => {
  const defaults = createDefaultTopics();
  const [main] = defaults;
  const legacySnapshot: TopicConfig[] = [
    { ...main, name: 'Diversos', description: 'Antiga', targetPct: 0.1 },
    ...defaults.slice(1),
    created('pets', 4, 0.1),
  ];

  it('a % e a sobra dela vão para Prazeres e Confortos, e o nome muda também no mês', () => {
    const next = consolidateMonthTopics(
      legacySnapshot,
      { [main.id]: 50, pets: 30, [defaults[1].id]: 5 },
      defaults,
    );
    expect(ids(next.topicsSnapshot)).toEqual(ids(defaults));
    expect(next.topicsSnapshot[0]).toMatchObject({
      name: 'Prazeres e Confortos',
      description: DEFAULT_TOPICS[0].description,
      targetPct: 0.2,
    });
    expect(next.carryIn).toEqual({ [main.id]: 80, [defaults[1].id]: 5 });
  });

  it('os números do mês continuam os mesmos depois de juntar', () => {
    const month = previousMonth(currentMonthKey());
    const expense = (id: string, topicId: string, amount: number): Expense => ({
      id,
      categoryKind: 'topic',
      topicId,
      description: id,
      amount,
      date: `${month}-10`,
    });
    const settings: BudgetSettings = {
      topics: [{ ...main, targetPct: 0.1 }, ...defaults.slice(1), created('pets', 4, 0.1)],
      specialCategories: { fixedCost: 'Custos Fixos', unforeseen: 'Imprevistos' },
      quickCategories: ['topic:pets', `topic:${main.id}`, 'fixedCost'],
    };
    const data: MonthData = {
      month,
      incomes: [
        { id: 'salario', source: 'Salário', amount: 1000 },
        { id: 'bico', source: 'Bico', amount: 200, topicId: 'pets' },
      ],
      expenses: [
        expense('racao', 'pets', 70),
        expense('cinema', main.id, 40),
        { id: 'luz', categoryKind: 'fixedCost', description: 'Luz', amount: 100, date: `${month}-05` },
      ],
      carryIn: { [main.id]: 10, pets: 20 },
      topicsSnapshot: settings.topics,
    };
    const before = computeMonthSummary(data);
    const after = consolidateBudgetData(settings, [data]);
    const summary = computeMonthSummary(after.months[0]);

    expect(after.settings.topics).toHaveLength(4);
    expect(after.settings.quickCategories).toEqual([`topic:${main.id}`, 'fixedCost']);
    expect(after.months[0].expenses.find((e) => e.id === 'racao')?.topicId).toBe(main.id);
    expect(after.months[0].incomes.find((i) => i.id === 'bico')?.topicId).toBe(main.id);
    expect(summary.incomeTotal).toBe(before.incomeTotal);
    expect(summary.expenseTotal).toBe(before.expenseTotal);
    expect(summary.availableTotal).toBeCloseTo(before.availableTotal, 6);
    const merged = summary.topics.find((t) => t.topicId === main.id)!;
    const was = before.topics.filter((t) => t.topicId === main.id || t.topicId === 'pets');
    expect(merged.spent).toBe(was.reduce((total, t) => total + t.spent, 0));
    expect(merged.remaining).toBeCloseTo(
      was.reduce((total, t) => total + t.remaining, 0),
      6,
    );
  });
});

describe('categoria arquivada nos meses', () => {
  const topics: TopicConfig[] = [
    { id: 'a', name: 'A', targetPct: 0.5, order: 0 },
    { id: 'b', name: 'B', targetPct: 0.5, order: 1 },
  ];
  const expense = (topicId: string, month: string): Expense => ({
    id: `e-${topicId}`,
    categoryKind: 'topic',
    topicId,
    description: 'x',
    amount: 100,
    date: `${month}-10`,
  });
  const monthData = (month: string, expenses: Expense[] = []): MonthData => ({
    month,
    incomes: [{ id: 'i', source: 'Salário', amount: 1000 }],
    expenses,
    carryIn: { a: 0, b: 0 },
    topicsSnapshot: topics,
  });
  // B archived and A taking its share, in the settings of today.
  const live: TopicConfig[] = [
    { ...topics[0], targetPct: 1 },
    { ...topics[1], archived: true },
  ];

  it('some do mês atual e dos próximos, e as % continuam fechando', () => {
    for (const month of [currentMonthKey(), nextMonth(currentMonthKey())]) {
      const summary = computeMonthSummary(monthData(month), live);
      expect(summary.topics.map((t) => t.topicId)).toEqual(['a']);
      expect(summary.availableTotal).toBe(1000);
    }
  });

  it('fica no mês atual, sem % da renda, enquanto tiver gastos nele', () => {
    const month = currentMonthKey();
    const summary = computeMonthSummary(monthData(month, [expense('b', month)]), live);
    const b = summary.topics.find((t) => t.topicId === 'b');
    expect(b).toMatchObject({ archived: true, targetPct: 0, spent: 100, available: 0, remaining: -100 });
    expect(summary.expenseTotal).toBe(100);
    expect(summary.topics.find((t) => t.topicId === 'a')?.available).toBe(1000);
  });

  it('não muda um mês que já passou', () => {
    const month = previousMonth(currentMonthKey());
    const summary = computeMonthSummary(monthData(month, [expense('b', month)]), live);
    expect(summary.topics.map((t) => [t.topicId, t.targetPct, t.archived])).toEqual([
      ['a', 0.5, false],
      ['b', 0.5, false],
    ]);
  });
});
