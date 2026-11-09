'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  computeMonthSummary,
  currentMonthKey,
  lastMonthWithAllClosed,
  type Month,
  type MonthData,
  type MonthSummary,
  type TopicConfig,
} from '@/lib/budget';
import { budgetRepository, closeMonthsBefore, fetchMonthsToClose } from '@/lib/storage';

export interface MonthsToClose {
  /** The latest month still open, with what was left in each category. */
  summary: MonthSummary;
  /** The month its leftovers would go to. */
  target: Month;
  /** Closes it, with the answer about the leftovers. The month on screen needs a refresh after it. */
  close: (bringLeftovers: boolean) => Promise<void>;
  /** With more than one month open: all of them at once. */
  all: {
    months: Month[];
    /** The last month with everything before it closed: what would reach today's month. */
    summary: MonthSummary;
    close: (bringLeftovers: boolean) => Promise<void>;
  } | null;
}

/**
 * What the turn of the month leaves to do: on today's month, the months before it still open. No
 * leftovers pass until they are closed. A failed read only leaves the buttons out, since every
 * month still has its own "Fechar mês".
 */
export function useMonthsToClose(month: Month, currentTopics?: TopicConfig[]): MonthsToClose | null {
  const [chain, setChain] = useState<MonthData[]>([]);

  const load = useCallback(
    async () => (month === currentMonthKey() ? fetchMonthsToClose(month) : []),
    [month],
  );

  useEffect(() => {
    let stale = false;
    load()
      .then((found) => {
        if (!stale) setChain(found);
      })
      .catch(() => {
        if (!stale) setChain([]);
      });
    return () => {
      stale = true;
    };
  }, [load]);

  const open = chain.filter((data) => !data.closed);
  const latest = open.at(-1);
  if (!latest) return null;

  /** After closing, what is still open; the close already happened, so a failed read is no failure. */
  const reload = async () => setChain(await load().catch(() => []));
  const preview = open.length > 1 ? lastMonthWithAllClosed(chain, computeMonthSummary) : undefined;

  return {
    summary: computeMonthSummary(latest, currentTopics),
    target: chain[chain.indexOf(latest) + 1]?.month ?? month,
    close: async (bringLeftovers) => {
      // No need to open the month on screen: until it is stored, it reads the answer from here.
      await budgetRepository.closeMonth(latest.month, false, !bringLeftovers);
      await reload();
    },
    all: preview
      ? {
          months: open.map((data) => data.month),
          summary: computeMonthSummary(preview, currentTopics),
          close: async (bringLeftovers) => {
            await closeMonthsBefore(month, !bringLeftovers);
            await reload();
          },
        }
      : null,
  };
}
