'use client';

import { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { IconTile } from '@/components/ui/IconTile';
import { currentSubscription, pushSupport } from '@/lib/notifications/browser';
import { InstallAppButton } from './InstallAppButton';

/**
 * A nudge when this device would not receive the notifications (Lembretes, cartões, contas do mês).
 * On an iPhone in the browser they can't be turned on: installing the app comes first.
 */
export function NotificationsHint({ onActivate }: { onActivate: () => void }) {
  const [hint, setHint] = useState<'activate' | 'install' | null>(null);

  useEffect(() => {
    const support = pushSupport();
    if (support === 'ios-install') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHint('install');
      return;
    }
    if (support !== 'supported') return;
    currentSubscription()
      .then((subscription) => setHint(subscription ? null : 'activate'))
      .catch(() => setHint(null));
  }, []);

  if (!hint) return null;
  if (hint === 'install') {
    return (
      <div className="border-border bg-card mx-4 flex flex-col gap-3 rounded-xl border p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <IconTile icon={BellOff} tone="amber" />
          <p className="text-muted min-w-0 flex-1 text-sm">
            Os avisos só chegam neste aparelho com o app instalado.
          </p>
        </div>
        <InstallAppButton />
      </div>
    );
  }
  return (
    <div className="border-border bg-card mx-4 flex items-center gap-3 rounded-xl border p-3 shadow-sm">
      <IconTile icon={BellOff} tone="amber" />
      <p className="text-muted min-w-0 flex-1 text-sm">Este aparelho ainda não recebe os avisos.</p>
      <button type="button" onClick={onActivate} className="text-primary shrink-0 text-sm font-semibold">
        Ativar
      </button>
    </div>
  );
}
