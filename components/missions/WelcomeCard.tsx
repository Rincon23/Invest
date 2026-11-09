'use client';

import { firstName } from '@/lib/auth/names';
import { nextMissions, type MissionsStatus } from '@/lib/gamification/missions';
import { useAuth } from '@/components/providers/AuthProvider';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LevelIcon } from './levelVisuals';
import { useMissionAction } from './useMissionAction';

/**
 * The first access: no choices to make (every module is already there), just the idea of the app
 * in one line — using it is XP — and the first missions. "Começar" takes the person to the first.
 */
export function WelcomeCard({ status, onClose }: { status: MissionsStatus; onClose: () => void }) {
  const { user } = useAuth();
  const goThere = useMissionAction();
  const name = firstName(user.name);
  const first = nextMissions(status.missions, 3);

  return (
    <BottomSheet open title={name ? `Boas-vindas, ${name}!` : 'Boas-vindas!'} onClose={onClose} confirmDiscard={false}>
      <div className="flex flex-col items-center gap-4 pb-2 text-center">
        <span className="bg-series-3/15 text-series-3 motion-safe:animate-level-up flex h-20 w-20 items-center justify-center rounded-full">
          <LevelIcon level={1} className="h-10 w-10" />
        </span>
        <p className="text-foreground text-base font-semibold">Usar o app vale XP e faz sua árvore crescer.</p>
        {first.length > 0 && (
          <ul className="border-border divide-border w-full divide-y rounded-xl border text-left text-sm">
            {first.map((mission) => (
              <li key={mission.key} className="flex min-h-[44px] items-center gap-3 px-3">
                <span aria-hidden className="border-border h-5 w-5 shrink-0 rounded-full border-2" />
                <span className="text-foreground min-w-0 flex-1 font-medium">{mission.title}</span>
                <span className="text-success shrink-0 text-xs font-semibold tabular-nums">+{mission.xp} XP</span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => {
            onClose();
            if (first[0]) goThere(first[0]);
          }}
          className="bg-primary text-primary-foreground min-h-[44px] w-full rounded-lg px-4 text-sm font-semibold"
        >
          Começar
        </button>
      </div>
    </BottomSheet>
  );
}
