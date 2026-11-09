import type {
  BudgetSettings,
  CategoryKind,
  QuickCategoryKey,
  ResolvedSpecialCategoryLabels,
  SpecialCategoryLabels,
  TopicConfig,
} from './types';

/**
 * Default labels for the special categories. "A receber" is the user-facing
 * name of what the old Telegram bot called "Ressarcido" — that name never shows in the app.
 */
export const DEFAULT_SPECIAL_CATEGORY_LABELS: ResolvedSpecialCategoryLabels = {
  fixedCost: 'Custos Fixos',
  unforeseen: 'Imprevistos',
  reimbursable: 'A receber',
  uncounted: 'Fora do orçamento',
};

/** Shown wherever the "A receber" category appears, so its behaviour is never a surprise. */
export const REIMBURSABLE_EXPLANATION =
  'Alguém vai te devolver. Não gasta categoria; no cartão, entra na fatura.';

/**
 * Shown wherever "Fora do orçamento" appears. The category exists because sometimes there is no
 * honest category for a gasto, but it is the one choice the app argues against: o dinheiro sai
 * do mesmo jeito e o orçamento do mês fica parecendo melhor do que é.
 */
export const UNCOUNTED_EXPLANATION =
  'Fica registrado, mas não gasta categoria nem entra no total do mês.';

/** Why the app marks "Fora do orçamento" as "Não recomendado" wherever it is offered. */
export const UNCOUNTED_ADVICE =
  'Não recomendado: o dinheiro saiu e nenhuma categoria mostra.';

/**
 * Shown when an income goes to one category only. It is allowed — a gift meant for a trip, a
 * refund of something bought in one category — but the % stop describing the month.
 */
export const INCOME_ONE_TOPIC_EXPLANATION =
  'A renda toda vai para a categoria escolhida; as outras não recebem nada.';

/** Why the app marks "Uma categoria só" as "Não recomendado" in the income form. */
export const INCOME_ONE_TOPIC_ADVICE =
  'Não recomendado: pelas %, a renda mantém o seu equilíbrio.';

/** Special-category labels with any missing entry (older data) filled from the defaults. */
export function resolveSpecialCategoryLabels(
  source: Pick<BudgetSettings, 'specialCategories'> | SpecialCategoryLabels | undefined,
): ResolvedSpecialCategoryLabels {
  const labels = source && 'specialCategories' in source ? source.specialCategories : source;
  return { ...DEFAULT_SPECIAL_CATEGORY_LABELS, ...labels };
}

/** The label for a special category; '' for 'topic', which carries its own name. */
export function specialCategoryLabel(kind: CategoryKind, labels: SpecialCategoryLabels | undefined): string {
  if (kind === 'topic') return '';
  return resolveSpecialCategoryLabels(labels)[kind];
}

/** How the expense form names a category in its lists (see `QuickCategoryKey`). */
export function quickCategoryKey(value: { categoryKind: CategoryKind; topicId?: string }): QuickCategoryKey {
  return value.categoryKind === 'topic' ? `topic:${value.topicId ?? ''}` : value.categoryKind;
}

/**
 * The categories the expense form shows straight away. Until the person picks their own, that is
 * every category of the budget plus Custos Fixos and Imprevistos; "A receber" and "Fora do
 * orçamento" — the ones used now and then — wait behind "Outras".
 */
export function resolveQuickCategories(
  quick: QuickCategoryKey[] | null | undefined,
  topics: TopicConfig[],
): QuickCategoryKey[] {
  if (quick) return quick;
  return [
    ...topics.filter((topic) => !topic.archived).map((topic) => `topic:${topic.id}` as const),
    'fixedCost',
    'unforeseen',
  ];
}
