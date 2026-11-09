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
import { currentMonthKey, type Month } from '@/lib/budget';
import { walletRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { getLastViewedMonth } from '@/lib/storage/preferences';
import type { WalletSnapshot } from '@/lib/storage/wallet';

interface WalletContextValue {
  snapshot: WalletSnapshot | null;
  loading: boolean;
  error: string | null;
  /** The competence the Carteira writes to: the month the user was last looking at. */
  month: Month;
  refresh: () => Promise<void>;
  /** Runs a write and reloads the snapshot. Throws the original error after reloading. */
  run: (action: () => Promise<void>) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Loads the whole Carteira once for every screen under /carteira, and reloads it after each
 * write — the four areas share numbers (an instalment changes the cash report, an allocation
 * changes a category), so there is no point in keeping them apart.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Client-only (localStorage), applied after mount so hydration always matches the server.
  const [month, setMonth] = useState<Month>(currentMonthKey);

  useEffect(() => {
    const stored = getLastViewedMonth();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setMonth(stored);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await walletRepository.getSnapshot());
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível carregar a Carteira.'));
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
    () => ({ snapshot, loading, error, month, refresh, run }),
    [snapshot, loading, error, month, refresh, run],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet deve ser usado dentro de WalletProvider');
  return ctx;
}
