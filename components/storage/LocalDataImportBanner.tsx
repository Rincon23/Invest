'use client';

import { useEffect, useState } from 'react';
import { budgetRepository } from '@/lib/storage';
import { hasLocalData, importLocalDataToCloud } from '@/lib/storage/localMigration';

/**
 * Shown on the first authenticated screen when this device still has v1 data in
 * IndexedDB and the cloud account has no months yet. Offers a one-time import;
 * "Agora não" hides it for the session, and the Configurações screen keeps the
 * option available while local data remains.
 */
export function LocalDataImportBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!(await hasLocalData())) return;
        const months = await budgetRepository.listMonths();
        if (active && months.length === 0) setVisible(true);
      } catch {
        // Never block the app on this check.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!visible) return null;

  async function handleImport() {
    setBusy(true);
    setError(null);
    try {
      await importLocalDataToCloud();
      // Full reload (not router navigation): every screen's repository-backed state
      // must be re-read from scratch after a wholesale data replacement.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao importar.');
      setBusy(false);
    }
  }

  function dismissForNow() {
    setVisible(false);
  }

  return (
    <div className="border-border bg-card mx-4 mt-4 flex flex-col gap-2 rounded-xl border p-4 text-sm shadow-sm">
      <p className="text-foreground font-medium">Encontramos dados salvos neste dispositivo.</p>
      <p className="text-muted">
        Importar substitui os dados da sua conta.
      </p>
      {error && <p className="text-danger">{error}</p>}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={handleImport}
          disabled={busy}
          className="bg-primary text-primary-foreground min-h-[40px] flex-1 rounded-lg px-3 font-semibold disabled:opacity-50"
        >
          {busy ? 'Importando…' : 'Importar'}
        </button>
        <button
          type="button"
          onClick={dismissForNow}
          disabled={busy}
          className="border-border text-foreground min-h-[40px] rounded-lg border px-3 font-medium disabled:opacity-50"
        >
          Agora não
        </button>
      </div>
    </div>
  );
}
