'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DiagramOverview } from '@/lib/diagram';
import { diagramRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';

/**
 * The Diagrama as the screen (and its widget) sees it: one read of everything, and a reload after
 * every write — a new answer changes a score, which changes the aporte, so nothing is kept apart.
 */
export function useDiagram() {
  const [overview, setOverview] = useState<DiagramOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Reloads everything and hands back what it read (null when it failed). */
  const refresh = useCallback(async (): Promise<DiagramOverview | null> => {
    setLoading(true);
    try {
      const next = await diagramRepository.getOverview();
      setOverview(next);
      setError(null);
      return next;
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível abrir o Diagrama.'));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  /** Runs a write and reloads. Throws the original error after reloading. */
  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  return { overview, error, loading, refresh, run };
}

export type DiagramState = ReturnType<typeof useDiagram>;
