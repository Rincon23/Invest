import { describe, expect, it } from 'vitest';
import { computeMonthSummary } from '../calculations';
import {
  DEFAULT_TOPIC_COLORS,
  normalizeSettings,
  resolveTopicColor,
  withCurrentTopicDisplay,
  withTopicColors,
} from '../colors';
import { currentMonthKey } from '../date';
import type { BudgetSettings, MonthData, TopicConfig } from '../types';

const TOPICS: TopicConfig[] = [
  { id: 'a', name: 'A', targetPct: 0.5, order: 0 },
  { id: 'b', name: 'B', targetPct: 0.3, order: 1 },
  { id: 'c', name: 'C', targetPct: 0.2, order: 2, color: '#123456' },
];

function month(topics: TopicConfig[]): MonthData {
  return {
    month: '2026-03',
    incomes: [{ id: 'i', source: 'x', amount: 1000 }],
    expenses: [],
    carryIn: {},
    topicsSnapshot: topics,
  };
}

describe('withTopicColors', () => {
  it('keeps colors that are already set', () => {
    expect(withTopicColors(TOPICS).find((t) => t.id === 'c')?.color).toBe('#123456');
  });

  it('fills missing colors from the palette by ordered position', () => {
    const filled = withTopicColors(TOPICS);
    expect(filled.find((t) => t.id === 'a')?.color).toBe(DEFAULT_TOPIC_COLORS[0]);
    expect(filled.find((t) => t.id === 'b')?.color).toBe(DEFAULT_TOPIC_COLORS[1]);
  });

  it('gives a topic the same auto color regardless of array order (reorder-safe)', () => {
    const reordered = [...TOPICS].reverse();
    const before = withTopicColors(TOPICS).find((t) => t.id === 'a')?.color;
    const after = withTopicColors(reordered).find((t) => t.id === 'a')?.color;
    expect(after).toBe(before);
  });

  it('follows the `order` field, not the array index', () => {
    const swappedOrder: TopicConfig[] = [
      { ...TOPICS[0], order: 1 },
      { ...TOPICS[1], order: 0 },
      TOPICS[2],
    ];
    const filled = withTopicColors(swappedOrder);
    // b is now first by order -> palette slot 0; a is second -> slot 1
    expect(filled.find((t) => t.id === 'b')?.color).toBe(DEFAULT_TOPIC_COLORS[0]);
    expect(filled.find((t) => t.id === 'a')?.color).toBe(DEFAULT_TOPIC_COLORS[1]);
  });
});

describe('normalizeSettings', () => {
  it('fills topic colors and completes the special-category colors', () => {
    const raw: BudgetSettings = {
      topics: TOPICS,
      specialCategories: { fixedCost: 'F', unforeseen: 'U' },
      specialCategoryColors: { fixedCost: '#000000' },
    };
    const normalized = normalizeSettings(raw);
    expect(normalized.topics.every((t) => typeof t.color === 'string')).toBe(true);
    expect(normalized.specialCategoryColors?.fixedCost).toBe('#000000');
    expect(normalized.specialCategoryColors?.unforeseen).toBeTruthy();
  });
});

describe('withCurrentTopicDisplay', () => {
  it('refreshes name and color from the live settings but keeps targetPct/order when not live', () => {
    const snapshot = withTopicColors(TOPICS);
    const live = snapshot.map((t) => ({ ...t, name: `${t.name} (novo)`, color: '#abcdef' }));
    const merged = withCurrentTopicDisplay(snapshot, live);
    const a = merged.find((t) => t.id === 'a')!;
    expect(a.name).toBe('A (novo)');
    expect(a.color).toBe('#abcdef');
    expect(a.targetPct).toBe(0.5); // frozen
    expect(a.order).toBe(0); // frozen
  });

  it('also syncs order when live is true, so a Settings reorder reorders the month too', () => {
    const snapshot = withTopicColors(TOPICS);
    // Reorder in Settings: 'b' moves to the front.
    const live = snapshot.map((t) => {
      if (t.id === 'b') return { ...t, order: 0 };
      if (t.id === 'a') return { ...t, order: 1 };
      return t;
    });
    const merged = withCurrentTopicDisplay(snapshot, live, true);
    expect(merged.find((t) => t.id === 'b')?.order).toBe(0);
    expect(merged.find((t) => t.id === 'a')?.order).toBe(1);
  });

  it('keeps the snapshot name for a topic no longer in settings', () => {
    const snapshot = withTopicColors(TOPICS);
    const live = snapshot.filter((t) => t.id !== 'c');
    expect(withCurrentTopicDisplay(snapshot, live).find((t) => t.id === 'c')?.name).toBe('C');
  });

  it('also syncs targetPct when syncTargetPct is true', () => {
    const snapshot = withTopicColors(TOPICS);
    const live = snapshot.map((t) => (t.id === 'a' ? { ...t, targetPct: 0.9 } : t));
    const merged = withCurrentTopicDisplay(snapshot, live, true);
    expect(merged.find((t) => t.id === 'a')?.targetPct).toBe(0.9);
  });

  it('when live, includes a category created after the snapshot was taken', () => {
    const snapshot = withTopicColors(TOPICS);
    const live = [...snapshot, { id: 'd', name: 'D', targetPct: 0, order: 3 }];
    const merged = withCurrentTopicDisplay(snapshot, live, true);
    expect(merged.find((t) => t.id === 'd')?.name).toBe('D');
  });

  it('when not live, never includes a category created after the snapshot was taken', () => {
    const snapshot = withTopicColors(TOPICS);
    const live = [...snapshot, { id: 'd', name: 'D', targetPct: 0, order: 3 }];
    const merged = withCurrentTopicDisplay(snapshot, live, false);
    expect(merged.find((t) => t.id === 'd')).toBeUndefined();
  });

  it('when live, drops a category deleted from settings', () => {
    const snapshot = withTopicColors(TOPICS);
    const live = snapshot.filter((t) => t.id !== 'c');
    const merged = withCurrentTopicDisplay(snapshot, live, true);
    expect(merged.find((t) => t.id === 'c')).toBeUndefined();
  });

  it('when not live, keeps a category deleted from settings (past-month freeze)', () => {
    const snapshot = withTopicColors(TOPICS);
    const live = snapshot.filter((t) => t.id !== 'c');
    const merged = withCurrentTopicDisplay(snapshot, live, false);
    expect(merged.find((t) => t.id === 'c')?.name).toBe('C');
  });
});

describe('computeMonthSummary colors', () => {
  it('uses the live settings color, not the frozen snapshot color', () => {
    const snapshot = withTopicColors(TOPICS); // colors baked into the month
    const liveTopics = snapshot.map((t) => ({ ...t, color: '#ff0000' })); // user recolored everything

    const summary = computeMonthSummary(month(snapshot), liveTopics);
    expect(summary.topics.every((t) => t.color === '#ff0000')).toBe(true);
  });

  it('uses the live settings name (a rename shows in the month summary)', () => {
    const snapshot = withTopicColors(TOPICS);
    const renamed = snapshot.map((t) => (t.id === 'a' ? { ...t, name: 'Renomeado' } : t));
    const summary = computeMonthSummary(month(snapshot), renamed);
    expect(summary.topics.find((t) => t.topicId === 'a')?.name).toBe('Renomeado');
  });

  it('falls back to the snapshot / palette color when no live topics are given', () => {
    const summary = computeMonthSummary(month(TOPICS));
    expect(summary.topics.find((t) => t.topicId === 'c')?.color).toBe('#123456');
    expect(summary.topics.find((t) => t.topicId === 'a')?.color).toBe(
      resolveTopicColor({ color: undefined }, 0),
    );
  });

  it('keeps the snapshot color for a topic no longer present in live settings', () => {
    const snapshot = withTopicColors(TOPICS);
    const liveTopics = snapshot.filter((t) => t.id !== 'c'); // 'c' was deleted from settings
    const summary = computeMonthSummary(month(snapshot), liveTopics);
    expect(summary.topics.find((t) => t.topicId === 'c')?.color).toBe('#123456');
  });

  it('a category created in Settings shows up in the current month summary', () => {
    const snapshot = withTopicColors(TOPICS);
    const liveTopics = [...snapshot, { id: 'd', name: 'Nova categoria', targetPct: 0, order: 3 }];
    const presentMonth: MonthData = { ...month(snapshot), month: currentMonthKey() };
    const summary = computeMonthSummary(presentMonth, liveTopics);
    expect(summary.topics.find((t) => t.topicId === 'd')?.name).toBe('Nova categoria');
  });

  it('a category deleted in Settings drops out of the current month summary', () => {
    const snapshot = withTopicColors(TOPICS);
    const liveTopics = snapshot.filter((t) => t.id !== 'c');
    const presentMonth: MonthData = { ...month(snapshot), month: currentMonthKey() };
    const summary = computeMonthSummary(presentMonth, liveTopics);
    expect(summary.topics.find((t) => t.topicId === 'c')).toBeUndefined();
  });

  it('a category created in Settings never appears in a past month summary', () => {
    const snapshot = withTopicColors(TOPICS);
    const liveTopics = [...snapshot, { id: 'd', name: 'Nova categoria', targetPct: 0, order: 3 }];
    const pastMonth: MonthData = { ...month(snapshot), month: '2000-01' };
    const summary = computeMonthSummary(pastMonth, liveTopics);
    expect(summary.topics.find((t) => t.topicId === 'd')).toBeUndefined();
  });
});

describe('computeMonthSummary targetPct freeze', () => {
  const snapshot = withTopicColors(TOPICS);
  const liveTopics = snapshot.map((t) => (t.id === 'a' ? { ...t, targetPct: 0.9 } : t));

  it('a percentage change in Settings never changes a past month', () => {
    const pastMonth: MonthData = { ...month(snapshot), month: '2000-01' };
    const summary = computeMonthSummary(pastMonth, liveTopics);
    expect(summary.topics.find((t) => t.topicId === 'a')?.targetPct).toBe(0.5);
  });

  it('a percentage change in Settings applies to the current month', () => {
    const presentMonth: MonthData = { ...month(snapshot), month: currentMonthKey() };
    const summary = computeMonthSummary(presentMonth, liveTopics);
    expect(summary.topics.find((t) => t.topicId === 'a')?.targetPct).toBe(0.9);
  });

  it('a percentage change in Settings applies to a future month', () => {
    const futureMonth: MonthData = { ...month(snapshot), month: '2999-01' };
    const summary = computeMonthSummary(futureMonth, liveTopics);
    expect(summary.topics.find((t) => t.topicId === 'a')?.targetPct).toBe(0.9);
  });
});
