'use client';

import type { ComponentType, ReactNode } from 'react';
import type { HomeWidgetKey } from '@/lib/core';
import { widgetModule } from '@/lib/modules';
import { BanksHomeCard } from './BanksHomeCard';
import { DiagramHomeCard } from './DiagramHomeCard';
import { HistoryHomeCard } from './HistoryHomeCard';
import { HomeCardBoundary } from './HomeCard';

interface CardSpec {
  /** A tile takes half the width and sits next to the tiles around it. */
  size: 'full' | 'half';
  Component: ComponentType;
}

/** The widget of each module that has one (see `homeCard` in the catalog). */
const CARDS: Partial<Record<HomeWidgetKey, CardSpec>> = {
  diagram: { size: 'full', Component: DiagramHomeCard },
  history: { size: 'full', Component: HistoryHomeCard },
  banks: { size: 'full', Component: BanksHomeCard },
};

/** Data several cards share would be read once here, above all the áreas. None yet. */
export function HomeCardsData({ children }: { keys: HomeWidgetKey[]; children: ReactNode }) {
  return children;
}

/** The Início cards a person can stretch to full width in edit mode — the tiles only: a
 * full card has its own layout that only makes sense at full width. */
export const RESIZABLE_HOME_CARDS: HomeWidgetKey[] = (Object.keys(CARDS) as HomeWidgetKey[]).filter(
  (key) => CARDS[key]?.size === 'half',
);

/** `CARDS[key]`'s size, unless it is resizable and the user stretched it to full width. */
export function effectiveSize(
  key: HomeWidgetKey,
  sizes: Partial<Record<HomeWidgetKey, 'half' | 'full'>>,
): 'full' | 'half' | undefined {
  const spec = CARDS[key];
  if (!spec) return undefined;
  return spec.size === 'half' && sizes[key] === 'full' ? 'full' : spec.size;
}

/**
 * The widgets of one área de trabalho, in the given order. Consecutive tiles share a row two by
 * two (an odd one out takes the whole row). Each card loads its own data and fails on its own.
 */
export function HomeCards({
  keys,
  sizes = {},
}: {
  keys: HomeWidgetKey[];
  /** Full width for a resizable tile the user stretched; see `RESIZABLE_HOME_CARDS`. */
  sizes?: Partial<Record<HomeWidgetKey, 'half' | 'full'>>;
}) {
  const blocks: HomeWidgetKey[][] = [];
  for (const key of keys) {
    if (!CARDS[key]) continue;
    const last = blocks.at(-1);
    if (effectiveSize(key, sizes) === 'half' && last && effectiveSize(last[0], sizes) === 'half')
      last.push(key);
    else blocks.push([key]);
  }

  // Each widget sits in a one-column grid (so a half tile stretches to its neighbour's height).
  // `grid-cols-1` is minmax(0, 1fr): with the default auto column, a long one-line text inside a
  // card (an e-mail subject, a reminder) widened the column and pushed the card off the screen.
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block) =>
        effectiveSize(block[0], sizes) === 'half' ? (
          <div key={block.join('-')} className="grid grid-cols-2 gap-3">
            {block.map((key, index) => (
              <div
                key={key}
                data-home-widget
                className={`grid min-w-0 grid-cols-1 ${block.length % 2 === 1 && index === block.length - 1 ? 'col-span-2' : ''}`}
              >
                <Card moduleKey={key} />
              </div>
            ))}
          </div>
        ) : (
          <div key={block[0]} data-home-widget className="grid min-w-0 grid-cols-1">
            <Card moduleKey={block[0]} />
          </div>
        ),
      )}
    </div>
  );
}

export function Card({ moduleKey }: { moduleKey: HomeWidgetKey }): ReactNode {
  const spec = CARDS[moduleKey];
  if (!spec) return null;
  const { Component } = spec;
  return (
    <HomeCardBoundary module={widgetModule(moduleKey)}>
      <Component />
    </HomeCardBoundary>
  );
}
