'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  computeMonthSummary,
  type MonthData,
  type MonthSummary,
  type TopicConfig,
} from '@/lib/budget';
import { budgetRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';

export interface UseAllMonthsResult {
  monthsData: MonthData[];
  summaries: MonthSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Loads every stored month, oldest to newest, for the history/charts screen.
 * `currentTopics` (live settings) is forwarded to `computeMonthSummary` for colors only.
 */
export function useAllMonths(currentTopics?: TopicConfig[]): UseAllMonthsResult {
  const [monthsData, setMonthsData] = useState<MonthData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const keys = await budgetRepository.listMonths();
      const all = await Promise.all(keys.map((key) => budgetRepository.getMonth(key)));
      const sorted = all
        .filter((m): m is MonthData => m !== undefined)
        .sort((a, b) => a.month.localeCompare(b.month));
      setMonthsData(sorted);
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Erro ao carregar o histórico.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Storage has no synchronous or Suspense-compatible read API, so months can only
    // be loaded after mount; this is the standard "fetch on mount" effect pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const summaries = monthsData.map((data) => computeMonthSummary(data, currentTopics));

  return { monthsData, summaries, loading, error, refresh };
}
