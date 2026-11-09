'use client';

import { Check } from 'lucide-react';
import type { LevelProgress } from '@/lib/gamification/levels';
import type { MissionState } from '@/lib/gamification/missions';

/** The bar up to the next level, with the XP in numbers. */
export function LevelBar({ level }: { level: LevelProgress }) {
  const pct = Math.round(level.progress * 100);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={level.next === null ? 'Último nível' : `XP até o próximo nível`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="bg-border h-2.5 w-full overflow-hidden rounded-full"
      >
        <div className="bg-success-fill h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-muted text-xs tabular-nums">
        {level.next === null ? `${level.xp} XP` : `${level.xp} / ${level.next} XP`}
      </p>
    </div>
  );
}

/** One mission: a button that takes the person there, or a done line. */
export function MissionRow({ mission, onGo }: { mission: MissionState; onGo: (mission: MissionState) => void }) {
  if (mission.done) {
    return (
      <li className="flex min-h-[44px] items-center gap-3 px-3 text-sm">
        <span aria-hidden className="bg-success-fill flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        <span className="text-muted min-w-0 flex-1 line-through">{mission.title}</span>
        <span className="text-muted shrink-0 text-xs tabular-nums">+{mission.xp} XP</span>
        <span className="sr-only">(feita)</span>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onGo(mission)}
        className="hover:bg-background flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm"
      >
        <span aria-hidden className="border-border h-6 w-6 shrink-0 rounded-full border-2" />
        <span className="text-foreground min-w-0 flex-1 py-1 font-medium">{mission.title}</span>
        <span className="bg-success-fill/15 text-success shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
          +{mission.xp} XP
        </span>
      </button>
    </li>
  );
}
