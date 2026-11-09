'use client';

import type { LevelProgress } from '@/lib/gamification/levels';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LevelIcon } from './levelVisuals';

/** "Você subiu de nível": the new level's tree and name, and nothing else to read. */
export function LevelUpCard({ level, onClose }: { level: LevelProgress; onClose: () => void }) {
  return (
    <BottomSheet open title="Você subiu de nível!" onClose={onClose} confirmDiscard={false}>
      <div className="flex flex-col items-center gap-3 pb-2 text-center">
        <span className="bg-series-3/15 text-series-3 motion-safe:animate-level-up flex h-24 w-24 items-center justify-center rounded-full">
          <LevelIcon level={level.level} className="h-12 w-12" />
        </span>
        <p className="text-muted text-sm font-medium">Nível {level.level}</p>
        <p className="text-foreground text-2xl font-bold">{level.name}</p>
        <button
          type="button"
          onClick={onClose}
          className="bg-primary text-primary-foreground mt-2 min-h-[44px] w-full rounded-lg px-4 text-sm font-semibold"
        >
          Continuar
        </button>
      </div>
    </BottomSheet>
  );
}
