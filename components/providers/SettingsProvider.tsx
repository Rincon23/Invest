'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { normalizeSettings, type AppSettings } from '@/lib/core';
import { withAccessRules } from '@/lib/modules';
import { settingsRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { useAuth } from './AuthProvider';

interface SettingsContextValue {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * The one-time notices saved or being saved. They only ever grow, so a save built from settings
   * read a moment earlier (a hint and a first-visit question saving together) never drops one.
   */
  const notices = useRef<string[]>([]);
  /** Saves go one after the other, so the last one sent is the one that stays. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await settingsRepository.getSettings();
      notices.current = data.dismissedNotices ?? [];
      setSettings(normalizeSettings(data));
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível carregar suas configurações.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The repository has no synchronous or Suspense-compatible read API, so settings can
    // only be loaded after mount; this is the standard "fetch on mount" effect pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const saveSettings = useCallback(
    (next: AppSettings) => {
      const seen = [...new Set([...notices.current, ...(next.dismissedNotices ?? [])])];
      notices.current = seen;
      const run = async () => {
        // The same rule the server applies: a VIP-only module stays off here too (a kit with one).
        const normalized = withAccessRules(
          normalizeSettings(seen.length > 0 ? { ...next, dismissedNotices: seen } : next),
          user,
        );
        await settingsRepository.saveSettings(normalized);
        setSettings(normalized);
      };
      const saved = queue.current.then(run, run);
      queue.current = saved.catch(() => {});
      return saved;
    },
    [user],
  );

  // A failure here blocks every screen (they all need settings), so surface it
  // in place rather than letting each screen spin on "Carregando…".
  if (error && !settings) {
    return <StorageErrorScreen message={error} onRetry={refresh} retrying={loading} />;
  }

  return (
    <SettingsContext.Provider value={{ settings, loading, error, refresh, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

function StorageErrorScreen({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-foreground text-sm font-medium">Não foi possível carregar seus dados</p>
      <p className="text-muted text-sm">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 font-semibold disabled:opacity-50"
      >
        {retrying ? 'Tentando…' : 'Tentar novamente'}
      </button>
    </div>
  );
}

/** The same, or null outside the provider — for a component that also renders on its own (tests). */
export function useOptionalSettings(): SettingsContextValue | null {
  return useContext(SettingsContext);
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings deve ser usado dentro de SettingsProvider');
  return ctx;
}
