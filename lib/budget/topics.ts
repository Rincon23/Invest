import { DEFAULT_TOPIC_COLORS, resolveTopicColor } from './colors';
import { createId } from './id';
import type { BudgetSettings, MonthData, QuickCategoryKey, TopicConfig, TopicPreset } from './types';

export interface DefaultTopic {
  preset: TopicPreset;
  name: string;
  description: string;
  targetPct: number;
}

/**
 * The four categories of every account, and what each one is for: the four goals a person's
 * spending has. They are the only ones — none is created, archived or renamed; only the % and the
 * colour are the person's (`enforceFixedTopics`). "Prazeres e Confortos" was called "Diversos",
 * which is why its preset is still `diversos`.
 */
export const DEFAULT_TOPICS: readonly DefaultTopic[] = [
  {
    preset: 'diversos',
    name: 'Prazeres e Confortos',
    description: 'Passeios, presentes, restaurantes e o que poderia esperar, mas você quer agora.',
    targetPct: 0.2,
  },
  {
    preset: 'investimentos',
    name: 'Investimentos',
    description: 'Qualquer investimento que faça o seu dinheiro render.',
    targetPct: 0.45,
  },
  {
    preset: 'metas',
    name: 'Metas',
    description: 'As conquistas maiores: casa, carro, casamento, aniversário, viagem.',
    targetPct: 0.25,
  },
  {
    preset: 'conhecimentos',
    name: 'Conhecimentos',
    description: 'Tudo que agrega conhecimento: cursos, livros, eventos.',
    targetPct: 0.1,
  },
];

/** What income, fixed costs and unforeseen costs mean, wherever the categories are explained. */
export const BUDGET_EXPLANATIONS = {
  income: 'Tudo que entrou no mês. Cada categoria recebe a sua %.',
  fixedCost:
    'Aluguel, contas, assinaturas: sai de cada categoria pela %.',
  unforeseen:
    'Celular quebrado, consulta: também sai de cada categoria pela %.',
} as const;

/**
 * When a monthly expense is better filed as a fixed cost than under a category. No example on
 * purpose: whether something fits depends on how much each person's category gets.
 */
export const FIXED_COST_TIP =
  'Gasto de todo mês maior que o limite da categoria vai em Custos Fixos.';

export function createDefaultTopics(): TopicConfig[] {
  return DEFAULT_TOPICS.map((topic, index) => ({
    id: createId(),
    ...topic,
    order: index,
    color: DEFAULT_TOPIC_COLORS[index],
  }));
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/** Names a default category had before, so data from before presets existed is still recognised. */
const FORMER_NAMES: Partial<Record<TopicPreset, string[]>> = { diversos: ['Diversos'] };

/**
 * Which default category a topic is: its `preset`, or, for data from before presets existed (no
 * `preset` and no `description` of its own), the default with the same name (or a former one).
 */
export function presetOf(topic: TopicConfig): DefaultTopic | undefined {
  if (topic.preset) return DEFAULT_TOPICS.find((d) => d.preset === topic.preset);
  if (topic.description !== undefined) return undefined;
  const name = fold(topic.name);
  return DEFAULT_TOPICS.find(
    (d) => fold(d.name) === name || (FORMER_NAMES[d.preset] ?? []).some((former) => fold(former) === name),
  );
}

/** The text that says what a category is for: its own, or the default one's. */
export function topicDescription(topic: TopicConfig): string {
  return topic.description ?? presetOf(topic)?.description ?? '';
}

/**
 * A topic with its preset and description made explicit (older data had neither), so an editor
 * can show and save them without losing which default category it is.
 */
export function normalizeTopic(topic: TopicConfig): TopicConfig {
  const preset = presetOf(topic)?.preset;
  return { ...topic, ...(preset ? { preset } : {}), description: topicDescription(topic) };
}

/** The categories in use (archived ones are never shown), in order. */
export function activeTopics(topics: readonly TopicConfig[]): TopicConfig[] {
  return topics.filter((topic) => !topic.archived).sort((a, b) => a.order - b.order);
}


/** A percentage without the float noise of adding a few of them (0.2 + 0.1). */
const roundPct = (pct: number) => Math.round(pct * 1e9) / 1e9;

/**
 * The topic of `topics` that plays each default category, in `DEFAULT_TOPICS` order, and the
 * ones left over. A topic marked with the preset wins over one recognised by its name, and an
 * active one over an archived one; a topic plays at most one.
 */
function pickPresets(topics: readonly TopicConfig[]): {
  picked: (TopicConfig | undefined)[];
  extras: TopicConfig[];
} {
  const used = new Set<string>();
  const candidates = [
    (t: TopicConfig, p: TopicPreset) => !t.archived && t.preset === p,
    (t: TopicConfig, p: TopicPreset) => t.preset === p,
    (t: TopicConfig, p: TopicPreset) => !t.archived && !t.preset && presetOf(t)?.preset === p,
    (t: TopicConfig, p: TopicPreset) => !t.preset && presetOf(t)?.preset === p,
  ];
  const picked = DEFAULT_TOPICS.map(({ preset }) => {
    for (const matches of candidates) {
      const found = topics.find((t) => !used.has(t.id) && matches(t, preset));
      if (found) {
        used.add(found.id);
        return found;
      }
    }
    return undefined;
  });
  return { picked, extras: topics.filter((t) => !used.has(t.id)) };
}

export interface ConsolidatedTopics {
  /** The four categories, in order, active, with their fixed name and description. */
  topics: TopicConfig[];
  /**
   * Every other category there was, by id, and the one that takes its place: Prazeres e
   * Confortos. Empty when the account already had only the four.
   */
  moved: Record<string, string>;
}

/**
 * Any list of categories as the four of today. Each one keeps its id, its % and its colour; a
 * default that was archived comes back with 0% (it was getting nothing) and a missing one is
 * created with 0%, so the % add up to what they did. Every other category goes away, and its %
 * goes to Prazeres e Confortos — so do its entries and its leftover, wherever the caller keeps
 * them (`moved`). An empty list is a new account: the four come as they are by default.
 */
export function consolidateTopics(topics: readonly TopicConfig[]): ConsolidatedTopics {
  if (topics.length === 0) return { topics: createDefaultTopics(), moved: {} };

  const { picked, extras } = pickPresets(topics);
  const fixed = DEFAULT_TOPICS.map((preset, index): TopicConfig => {
    const existing = picked[index];
    return {
      id: existing?.id ?? createId(),
      name: preset.name,
      description: preset.description,
      preset: preset.preset,
      targetPct: existing && !existing.archived ? existing.targetPct : 0,
      order: index,
      color: existing?.color ?? DEFAULT_TOPIC_COLORS[index],
    };
  });

  const [main] = fixed;
  const extraPct = extras.filter((t) => !t.archived).reduce((total, t) => total + t.targetPct, 0);
  if (extraPct !== 0) main.targetPct = roundPct(main.targetPct + extraPct);

  return { topics: fixed, moved: Object.fromEntries(extras.map((t) => [t.id, main.id])) };
}

/**
 * The categories to save: always the four of `current` (see `consolidateTopics`), taking from
 * `edited` only what the person may change — the % and the colour. A category the client added,
 * a new name, a new description, another order or an archived flag are all ignored.
 */
export function enforceFixedTopics(
  current: readonly TopicConfig[],
  edited: readonly TopicConfig[] = current,
): TopicConfig[] {
  return consolidateTopics(current).topics.map((topic) => {
    const edit =
      edited.find((t) => t.id === topic.id) ??
      edited.find((t) => !t.archived && presetOf(t)?.preset === topic.preset);
    if (!edit) return topic;
    return { ...topic, targetPct: edit.targetPct, ...(edit.color ? { color: edit.color } : {}) };
  });
}

/**
 * A month's own copy of the categories (and its leftovers) after `consolidateTopics`: the four
 * keep their place with the fixed name and description, and any other category is folded into
 * Prazeres e Confortos — its % and its leftover added to it — so the month's numbers add up to
 * what they did. `topics` are the four, as `consolidateTopics` returned them.
 */
export function consolidateMonthTopics(
  snapshot: readonly TopicConfig[],
  carryIn: Readonly<Record<string, number>>,
  topics: readonly TopicConfig[],
): { topicsSnapshot: TopicConfig[]; carryIn: Record<string, number> } {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const [main] = topics;
  const others = snapshot.filter((topic) => !byId.has(topic.id));
  const mergedPct = others.filter((t) => !t.archived).reduce((total, t) => total + t.targetPct, 0);

  const kept = snapshot
    .filter((topic) => byId.has(topic.id))
    .map((topic): TopicConfig => {
      const fixed = byId.get(topic.id)!;
      const renamed: TopicConfig = { ...topic, name: fixed.name, description: fixed.description, preset: fixed.preset };
      return topic.id === main.id && mergedPct !== 0
        ? { ...renamed, targetPct: roundPct(topic.targetPct + mergedPct) }
        : renamed;
    });
  // A month from before Prazeres e Confortos was in it still needs a place for what is folded in.
  if (others.length > 0 && !kept.some((topic) => topic.id === main.id)) {
    kept.unshift({ ...main, targetPct: roundPct(mergedPct) });
  }

  const nextCarry: Record<string, number> = {};
  for (const [id, value] of Object.entries(carryIn)) {
    const target = byId.has(id) ? id : main.id;
    nextCarry[target] = (nextCarry[target] ?? 0) + value;
  }
  return { topicsSnapshot: kept, carryIn: nextCarry };
}

/**
 * The topic an entry should point at once the categories are the four: its own when it is one of
 * them, otherwise Prazeres e Confortos. `undefined` stays `undefined` (not a category entry).
 */
export function fixedTopicId(topicId: string | undefined, topics: readonly TopicConfig[]): string | undefined {
  if (topicId === undefined) return undefined;
  return topics.some((topic) => topic.id === topicId) ? topicId : topics[0].id;
}

/**
 * Settings and months (a backup being restored) with the four categories only: see
 * `consolidateTopics` and `consolidateMonthTopics`. The expenses and incomes of a category that
 * goes away move to Prazeres e Confortos, and the quick categories of the expense form follow.
 */
export function consolidateBudgetData(
  settings: BudgetSettings,
  months: readonly MonthData[],
): { settings: BudgetSettings; months: MonthData[] } {
  const { topics } = consolidateTopics(settings.topics);
  const quickCategories = settings.quickCategories
    ? [
        ...new Set(
          settings.quickCategories.map((key): QuickCategoryKey =>
            key.startsWith('topic:') ? `topic:${fixedTopicId(key.slice('topic:'.length), topics)}` : key,
          ),
        ),
      ]
    : settings.quickCategories;
  return {
    settings: { ...settings, topics, quickCategories },
    months: months.map((data) => ({
      ...data,
      ...consolidateMonthTopics(data.topicsSnapshot, data.carryIn, topics),
      incomes: data.incomes.map((income) =>
        income.topicId ? { ...income, topicId: fixedTopicId(income.topicId, topics) } : income,
      ),
      expenses: data.expenses.map((expense) =>
        expense.topicId ? { ...expense, topicId: fixedTopicId(expense.topicId, topics) } : expense,
      ),
    })),
  };
}

/** The four with the % and the colours they come with ("Voltar às % padrão"); ids stay. */
export function withDefaultTargets(topics: readonly TopicConfig[]): TopicConfig[] {
  return consolidateTopics(topics).topics.map((topic, index) => ({
    ...topic,
    targetPct: DEFAULT_TOPICS[index].targetPct,
    color: DEFAULT_TOPIC_COLORS[index],
  }));
}

/** True when the four already have the % and the colours they come with. */
export function hasDefaultTargets(topics: readonly TopicConfig[]): boolean {
  const active = activeTopics(topics);
  return (
    active.length === DEFAULT_TOPICS.length &&
    DEFAULT_TOPICS.every((preset, index) => {
      const topic = active[index];
      return (
        presetOf(topic)?.preset === preset.preset &&
        resolveTopicColor(topic, index).toLowerCase() === DEFAULT_TOPIC_COLORS[index] &&
        Math.abs(topic.targetPct - preset.targetPct) < 1e-9
      );
    })
  );
}
