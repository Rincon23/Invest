'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { remindersRepository, type RemindersSnapshot } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';

interface RemindersContextValue {
  snapshot: RemindersSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Runs a write and reloads the snapshot. Throws the original error after reloading. */
  run: (action: () => Promise<void>) => Promise<void>;
}

const RemindersContext = createContext<RemindersContextValue | null>(null);

/** Loads the reminders once for a screen (or the home card) and reloads after every write. */
export function RemindersProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<RemindersSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await remindersRepository.getSnapshot());
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível carregar os lembretes.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const value = useMemo(
    () => ({ snapshot, loading, error, refresh, run }),
    [snapshot, loading, error, refresh, run],
  );
  return <RemindersContext.Provider value={value}>{children}</RemindersContext.Provider>;
}

export function useReminders(): RemindersContextValue {
  const context = useContext(RemindersContext);
  if (!context) throw new Error('useReminders precisa estar dentro de <RemindersProvider>.');
  return context;
}
