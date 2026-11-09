import { resolveSpecialCategoryLabels } from './categories';
import type { BudgetSettings, SpecialCategoryColors, TopicConfig } from './types';

/**
 * Default categorical palette for the categories, in fixed order. Hex (not CSS vars)
 * so it round-trips through `<input type="color">` and the database. Mirrors the
 * light-theme `--series-*` tokens in app/globals.css.
 */
export const DEFAULT_TOPIC_COLORS = [
  '#2a78d6',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#eb6834',
  '#4a3aa7',
  '#008300',
  '#e34948',
] as const;

/** Defaults for the special categories. */
export const DEFAULT_SPECIAL_CATEGORY_COLORS: SpecialCategoryColors = {
  fixedCost: '#6b7280',
  unforeseen: '#d97706',
  reimbursable: '#0d9488',
  uncounted: '#94a3b8',
};

/** Color to use for a topic: its own `color`, else a palette slot by position. */
export function resolveTopicColor(topic: Pick<TopicConfig, 'color'>, index: number): string {
  return topic.color ?? DEFAULT_TOPIC_COLORS[index % DEFAULT_TOPIC_COLORS.length];
}

/**
 * Returns `topics` with every `color` filled in. Missing colors are assigned a
 * palette slot by the topic's position when ordered — deterministic per topic
 * identity, so reordering later never changes a color that was auto-assigned.
 */
export function withTopicColors(topics: TopicConfig[]): TopicConfig[] {
  const slotById = new Map(
    [...topics]
      .sort((a, b) => a.order - b.order)
      .map(
        (topic, index) =>
          [topic.id, DEFAULT_TOPIC_COLORS[index % DEFAULT_TOPIC_COLORS.length]] as const,
      ),
  );
  return topics.map((topic) =>
    topic.color ? topic : { ...topic, color: slotById.get(topic.id) },
  );
}

/**
 * Snapshot topics with `name`, `description` and `color` refreshed from the
 * current settings (matched by id) — always, for every month, so a rename or
 * recolor shows everywhere immediately.
 *
 * `targetPct`, `order` and `archived` are only refreshed when `live` is true — the
 * caller's job to decide based on whether the month is in the past (frozen
 * forever) or the current/a future month (tracks Settings live) — so
 * reordering categories in Settings reorders the current/a future month too.
 *
 * When `live` is true, the topic *set* itself also tracks Settings: a
 * category added since the snapshot was taken is appended, and a category
 * deleted from Settings drops out — so creating or removing a category shows
 * up immediately in the current/a future month. When `live` is false (a past
 * month), the snapshot's set of topics is frozen: additions/removals in
 * Settings never retroactively change what an already-passed month shows.
 */
export function withCurrentTopicDisplay(
  snapshotTopics: TopicConfig[],
  currentTopics: readonly TopicConfig[] | undefined,
  live = false,
): TopicConfig[] {
  if (!currentTopics) return withTopicColors(snapshotTopics);
  const current = new Map(currentTopics.map((topic) => [topic.id, topic]));

  const reconciled = snapshotTopics
    .map((topic) => {
      const liveTopic = current.get(topic.id);
      if (!liveTopic) return live ? null : topic;
      return {
        ...topic,
        name: liveTopic.name,
        description: liveTopic.description ?? topic.description,
        preset: liveTopic.preset ?? topic.preset,
        color: liveTopic.color ?? topic.color,
        ...(live
          ? { targetPct: liveTopic.targetPct, order: liveTopic.order, archived: liveTopic.archived }
          : {}),
      };
    })
    .filter((topic): topic is TopicConfig => topic !== null);

  if (!live) return withTopicColors(reconciled);

  const snapshotIds = new Set(snapshotTopics.map((topic) => topic.id));
  const addedTopics = currentTopics.filter((topic) => !snapshotIds.has(topic.id));

  return withTopicColors([...reconciled, ...addedTopics]);
}

/**
 * Fills in anything older data may be missing — topic and special-category colors, and the
 * special-category labels — so every screen can read them without resolving again.
 */
export function normalizeSettings(settings: BudgetSettings): BudgetSettings {
  return {
    ...settings,
    topics: withTopicColors(settings.topics),
    specialCategories: resolveSpecialCategoryLabels(settings),
    specialCategoryColors: resolveSpecialCategoryColors(settings),
  };
}

/** Special-category colors with any missing entries filled from the defaults. */
export function resolveSpecialCategoryColors(
  source:
    | Pick<BudgetSettings, 'specialCategoryColors'>
    | Partial<SpecialCategoryColors>
    | undefined,
): SpecialCategoryColors {
  const colors =
    source && 'specialCategoryColors' in source ? source.specialCategoryColors : source;
  return { ...DEFAULT_SPECIAL_CATEGORY_COLORS, ...colors };
}
