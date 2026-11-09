'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Target } from 'lucide-react';
import { settingsRepository } from '@/lib/storage';
import { useSettings } from '@/components/providers/SettingsProvider';
import { BottomSheet } from '@/components/ui/BottomSheet';

/**
 * The first visit of a brand-new account: one short sheet that says what the app does and leads to
 * the Diagrama. Shown once (the settings remember it, on the server); no missions, no XP.
 */
export function WelcomeSheet() {
  const router = useRouter();
  const { settings, refresh } = useSettings();
  const [closed, setClosed] = useState(false);

  if (closed || settings?.onboardingCompleted !== false) return null;

  async function finish(goToDiagram: boolean) {
    setClosed(true);
    try {
      await settingsRepository.completeOnboarding();
      await refresh();
    } catch {
      // Not saved: the welcome shows again next time, which is harmless.
    }
    if (goToDiagram) router.push('/diagrama');
  }

  return (
    <BottomSheet open title="Boas-vindas ao Invest +" onClose={() => void finish(false)} confirmDiscard={false}>
      <div className="flex flex-col gap-4">
        <p className="text-muted text-sm">
          Diga quanto quer investir e o Diagrama diz quanto vai para cada ativo, pelas metas e notas que
          você der.
        </p>
        <button
          type="button"
          onClick={() => void finish(true)}
          className="bg-primary text-primary-foreground flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 font-semibold"
        >
          <Target aria-hidden className="h-4 w-4" />
          Começar pelo Diagrama
        </button>
      </div>
    </BottomSheet>
  );
}
