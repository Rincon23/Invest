'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Month, PendingReimbursable } from '@/lib/budget';
import { listPendingReimbursables } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';

/**
 * Every "A receber" still owed as of `month`: its own and the ones from the months before, which
 * stay on the list until someone pays them back. `version` reloads it (pass the month's data, so
 * a new or edited expense shows up).
 */
export function usePendingReimbursables(month: Month, enabled: boolean, version?: unknown) {
  const [pending, setPending] = useState<PendingReimbursable[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPending(await listPendingReimbursables(month));
      setError(null);
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível carregar o que ainda falta receber.'));
    }
  }, [month]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [enabled, reload, version]);

  return { pending, error, reload };
}
