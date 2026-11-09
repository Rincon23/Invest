'use client';

import { useEffect, useState } from 'react';
import type { BankHoldings } from '@/lib/banks';
import { isModuleOn, mayUseModule } from '@/lib/modules';
import { banksRepository } from '@/lib/storage';
import { useAuth } from '@/components/providers/AuthProvider';
import { useSettings } from '@/components/providers/SettingsProvider';

/**
 * What the banks say the person holds (Open Finance), for the Diagrama to compare quantities. Only
 * with Open Finance on (and VIP while it is "Só VIP"); read once per visit — the banks send data once a day, and
 * the comparison itself is redone on the screen after every change in the Diagrama.
 */
export function useBankHoldings(): BankHoldings | null {
  const { user } = useAuth();
  const { settings } = useSettings();
  const enabled = isModuleOn(settings, 'banks') && mayUseModule(user, 'banks');
  const [holdings, setHoldings] = useState<BankHoldings | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    banksRepository
      .getHoldings()
      .then((read) => {
        if (active) setHoldings(read);
      })
      // Without the banks, the Diagrama is just the Diagrama.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled]);

  return enabled ? holdings : null;
}
