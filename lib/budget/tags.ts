import { quickCategoryKey } from './categories';
import { DEFAULT_TOPIC_COLORS } from './colors';
import { createId } from './id';
import type { BudgetSettings, Expense, Income, QuickCategoryKey, Tag, TagKind, TopicConfig } from './types';

/**
 * Tags: labels on expenses and incomes to find and add them up later ("quanto gastei no
 * mercado este mês?"). A tag is control only — it changes no number of the budget. The category
 * is one of the four goals and decides where the money comes from; nothing in the calculations
 * (calculations.ts, rollover.ts, cards.ts, bill.ts, ...) ever reads a tag.
 */

export const TAG_LIMITS = {
  /** Characters in a tag's name. */
  name: 30,
  /** Tags on one entry. */
  perEntry: 10,
  /** Tags of one kind (expenses or incomes) in an account. */
  perKind: 100,
} as const;

/** What an empty list offers with one tap: create it and mark it. */
export const TAG_SUGGESTIONS: Record<TagKind, readonly string[]> = {
  expense: ['Mercado', 'Restaurante', 'Viagem'],
  income: ['Trabalho', 'Bico'],
};

/** The one line that tells a tag from a category, shown once where tags are first met. */
export const TAG_VS_CATEGORY =
  'Categoria é uma das suas 4 metas e decide de onde sai o dinheiro. Tag é só um rótulo para você achar depois.';

/** The rest of it, behind the ⓘ. */
export const TAG_VS_CATEGORY_DETAIL =
  'A tag não muda nenhum número: nem o limite, nem a sobra, nem a fatura. Serve para filtrar em Lançamentos e ver quanto foi, por exemplo, no mercado.';

/** The key of that one-time notice in `dismissedNotices`. */
export const TAG_NOTICE = 'tags-vs-categories';

/** A name as it is compared: no accents, no case, no extra spaces ("mercado" = "Mercado"). */
export function foldTagName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The tags of one kind, in their order. */
export function tagsOfKind(tags: readonly Tag[] | undefined, kind: TagKind): Tag[] {
  return (tags ?? []).filter((tag) => tag.kind === kind).sort((a, b) => a.order - b.order);
}

/**
 * Why `name` cannot be the name of a tag of `kind`, or null when it can. `exceptId` is the tag
 * being renamed (its own name is not a repeat). A tag never takes the name of one of the four
 * categories, so the two are never confused.
 */
export function tagNameProblem(
  name: string,
  kind: TagKind,
  tags: readonly Tag[] | undefined,
  topics: readonly TopicConfig[] = [],
  exceptId?: string,
): string | null {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Dê um nome para a tag.';
  if (trimmed.length > TAG_LIMITS.name) return `O nome da tag pode ter até ${TAG_LIMITS.name} letras.`;
  const folded = foldTagName(trimmed);
  if (topics.some((topic) => !topic.archived && foldTagName(topic.name) === folded)) {
    return 'Esse é o nome de uma categoria. Escolha outro para a tag.';
  }
  const same = tagsOfKind(tags, kind);
  if (same.some((tag) => tag.id !== exceptId && foldTagName(tag.name) === folded)) {
    return 'Já existe uma tag com esse nome.';
  }
  if (!exceptId && same.length >= TAG_LIMITS.perKind) {
    return `Dá para ter até ${TAG_LIMITS.perKind} tags de ${kind === 'expense' ? 'gasto' : 'renda'}.`;
  }
  return null;
}

/**
 * The colours offered when a tag is created (any other one can be picked too). Hex, so they go
 * through `<input type="color">` and the database as they are.
 */
export const TAG_COLORS: readonly string[] = [...DEFAULT_TOPIC_COLORS, '#0d9488', '#6b7280'];

/**
 * The colour of a tag's dot: its own, or, for a tag made before colours were chosen, a palette
 * slot by its place, so every tag has one.
 */
export function tagColor(tag: Pick<Tag, 'color' | 'order'>): string {
  return tag.color ?? TAG_COLORS[Math.abs(tag.order) % TAG_COLORS.length];
}

/** The colour a new tag of `kind` starts with: the first of the palette no tag of that kind has yet. */
export function nextTagColor(tags: readonly Tag[] | undefined, kind: TagKind): string {
  const same = tagsOfKind(tags, kind);
  const used = new Set(same.map((tag) => tagColor(tag).toLowerCase()));
  return (
    TAG_COLORS.find((color) => !used.has(color.toLowerCase())) ?? TAG_COLORS[same.length % TAG_COLORS.length]
  );
}

/**
 * A new tag of `kind`, placed after the others, with the colour chosen (or the next free one of
 * the palette). The name should have passed `tagNameProblem`.
 */
export function createTag(
  name: string,
  kind: TagKind,
  tags: readonly Tag[] | undefined,
  color?: string,
): Tag {
  const same = tagsOfKind(tags, kind);
  return {
    id: createId(),
    name: name.replace(/\s+/g, ' ').trim(),
    kind,
    color: color ?? nextTagColor(tags, kind),
    order: Math.max(-1, ...same.map((tag) => tag.order)) + 1,
  };
}

/**
 * The tags an account may keep: trimmed, without empty names, repeats (in the same kind) or names
 * of a category, and at most `TAG_LIMITS.perKind` of each kind. What the server stores, whatever
 * it was sent.
 */
export function sanitizeTags(tags: readonly Tag[] | undefined, topics: readonly TopicConfig[] = []): Tag[] {
  const kept: Tag[] = [];
  const ids = new Set<string>();
  for (const tag of [...(tags ?? [])].sort((a, b) => a.order - b.order)) {
    const name = tag.name.replace(/\s+/g, ' ').trim().slice(0, TAG_LIMITS.name);
    if (ids.has(tag.id) || tagNameProblem(name, tag.kind, kept, topics)) continue;
    ids.add(tag.id);
    kept.push({ ...tag, name });
  }
  return kept;
}

/**
 * The tags an entry may point at: only existing tags of its kind, each once, at most
 * `TAG_LIMITS.perEntry`. `valid` are the ids of the account's tags of that kind.
 */
export function cleanTagIds(tagIds: readonly string[] | undefined, valid: ReadonlySet<string>): string[] {
  return [...new Set(tagIds ?? [])].filter((id) => valid.has(id)).slice(0, TAG_LIMITS.perEntry);
}

/** The ids of the account's tags of `kind`. */
export function tagIdSet(settings: Pick<BudgetSettings, 'tags'> | undefined, kind: TagKind): Set<string> {
  return new Set(tagsOfKind(settings?.tags, kind).map((tag) => tag.id));
}

/**
 * Whether an entry passes the tag filter: no tag chosen lets everything through; otherwise the
 * entry needs at least one of them ("ou", like the categories of the filter).
 */
export function matchesTags(tagIds: readonly string[] | undefined, filter: readonly string[]): boolean {
  return filter.length === 0 || (tagIds ?? []).some((id) => filter.includes(id));
}

/** The tags of an entry, in the account's order (unknown ids are left out). */
export function entryTags(tagIds: readonly string[] | undefined, tags: readonly Tag[] | undefined): Tag[] {
  if (!tagIds || tagIds.length === 0) return [];
  return (tags ?? []).filter((tag) => tagIds.includes(tag.id)).sort((a, b) => a.order - b.order);
}

/** Whether `search` is found in the name of one of the entry's tags (the Lançamentos search). */
export function tagsMatchSearch(
  tagIds: readonly string[] | undefined,
  tags: readonly Tag[] | undefined,
  search: string,
): boolean {
  const query = foldTagName(search);
  if (!query) return false;
  return entryTags(tagIds, tags).some((tag) => foldTagName(tag.name).includes(query));
}

/** What the Lançamentos list is narrowed by. Empty lists and an empty search let everything through. */
export interface EntryFilter {
  /** Categories ("ou" among them), Gastos only. */
  categories?: readonly QuickCategoryKey[];
  /** Tag ids of the entry's kind ("ou" among them). */
  tagIds: readonly string[];
  /** Found in the description (or the source) or in the name of one of the entry's tags. */
  search: string;
  /** The account's tags, to search by name. */
  tags?: readonly Tag[];
}

function textMatches(text: string, tagIds: readonly string[] | undefined, filter: EntryFilter): boolean {
  return (
    text.toLowerCase().includes(filter.search.toLowerCase()) ||
    tagsMatchSearch(tagIds, filter.tags, filter.search)
  );
}

/**
 * Whether an expense stays in the Lançamentos list: one of the chosen categories **and** one of the
 * chosen tags (each list empty meaning "any"), and the search.
 */
export function expenseMatches(expense: Expense, filter: EntryFilter): boolean {
  const categories = filter.categories ?? [];
  return (
    (categories.length === 0 || categories.includes(quickCategoryKey(expense))) &&
    matchesTags(expense.tagIds, filter.tagIds) &&
    textMatches(expense.description, expense.tagIds, filter)
  );
}

/** The same for an income: its tags and the search (incomes have no category filter). */
export function incomeMatches(income: Income, filter: EntryFilter): boolean {
  return matchesTags(income.tagIds, filter.tagIds) && textMatches(income.source, income.tagIds, filter);
}

/** Where a tag was, so "Desfazer" after deleting it puts it back exactly there. */
export interface TagRefs {
  expenses: { month: string; id: string }[];
  incomes: { month: string; id: string }[];
  recurring: string[];
  installments: string[];
}
