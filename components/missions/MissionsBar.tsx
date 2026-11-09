'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { nextMissions, type MissionsStatus } from '@/lib/gamification/missions';
import { FactLine } from './FactLine';
import { useMissions } from './MissionsProvider';
import { LevelIcon } from './levelVisuals';

/**
 * Missões on top of the Início, under the greeting, for everyone and not a widget (nothing to take
 * off): the level's tree and name, a thin bar to the next level and the next mission to do, with the
 * "Você sabia?" of the day under them. A tap opens Missões. While the XP of the day is not claimed,
 * "Resgatar" sits on its right — it is the only way to get it. The tree is where earned XP flies to
 * (`data-xp-target`). Only there while there is something to do: with nothing, it is not shown.
 */
export function MissionsBar() {
  const { status, level, landing, claimDay } = useMissions();
  /** The status on screen when "Resgatar" was tapped: the button stays away until a new one comes. */
  const [claimedOn, setClaimedOn] = useState<MissionsStatus | null>(null);
  const [next] = status ? nextMissions(status.missions, 1) : [];
  const day = status?.missions.find((mission) => mission.key === 'open-app');
  const toClaim = day && !day.done && claimedOn !== status ? day : null;
  // With nothing else to do, the bar stays until the day's XP is in the tree.
  const line = next ?? toClaim ?? (landing || claimedOn === status ? day : null);
  if (!line || !level) return null;
  const pct = Math.round(level.progress * 100);

  return (
    <div data-tour="card-missions" className="border-border bg-card flex flex-col rounded-2xl border shadow-sm">
      <div className="flex items-center">
        <Link
          href="/missoes"
          aria-label={`Missões: ${level.name}, nível ${level.level}`}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5"
        >
          <span
            aria-hidden
            data-xp-target
            className="bg-series-3/15 text-series-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          >
            <LevelIcon level={level.level} className="h-5 w-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-foreground truncate text-sm font-semibold">{level.name}</span>
              <span className="text-muted shrink-0 text-xs tabular-nums">
                {level.next === null ? `${level.xp} XP` : `${level.xp} / ${level.next} XP`}
              </span>
            </span>
            <span aria-hidden className="bg-border block h-1.5 w-full overflow-hidden rounded-full">
              <span className="bg-success-fill block h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%` }} />
            </span>
            <span className="flex items-center gap-1.5 truncate text-xs">
              <span className="text-foreground truncate font-medium">{line.title}</span>
              <span className="text-success shrink-0 font-semibold tabular-nums">+{line.xp} XP</span>
            </span>
          </span>
          {!toClaim && <ChevronRight aria-hidden className="text-muted h-4 w-4 shrink-0" />}
        </Link>
        {toClaim && (
          <button
            type="button"
            data-tour="missoes-resgatar"
            onClick={(event) => {
              setClaimedOn(status);
              claimDay(event.currentTarget);
            }}
            aria-label={`Resgatar ${toClaim.xp} XP do dia`}
            className="bg-primary text-primary-foreground motion-safe:animate-claim-pulse mr-2.5 flex min-h-[44px] shrink-0 flex-col items-center justify-center rounded-xl px-3 leading-tight"
          >
            <span className="text-sm font-semibold">Resgatar</span>
            <span className="text-xs font-semibold tabular-nums">+{toClaim.xp} XP</span>
          </button>
        )}
      </div>
      {status?.fact && <FactLine fact={status.fact} className="border-border border-t px-3 py-2" />}
    </div>
  );
}
