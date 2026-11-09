'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { nextMissions, type MissionState } from '@/lib/gamification/missions';
import { FactLine } from '@/components/missions/FactLine';
import { LevelBar, MissionRow } from '@/components/missions/MissionParts';
import { useMissions } from '@/components/missions/MissionsProvider';
import { LevelIcon } from '@/components/missions/levelVisuals';
import { useMissionAction } from '@/components/missions/useMissionAction';
import { Skeleton } from '@/components/modules/home/HomeCard';

/**
 * Missões in the app drawer ("Seu progresso"): the level with its tree, the bar to the next one,
 * the (at most three) missions worth doing now, each a button that takes the person there (closing
 * the drawer), and the "Você sabia?" of the day. When everything is done, it says so in one line.
 */
export function MissionsCard({ onNavigate }: { onNavigate: () => void }) {
  const { status, level } = useMissions();
  const goThere = useMissionAction();

  function go(mission: MissionState) {
    onNavigate();
    goThere(mission);
  }

  const next = status ? nextMissions(status.missions) : [];

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
      <Link href="/missoes" onClick={onNavigate} className="-m-1 flex items-center gap-3 rounded-xl p-1">
        <span aria-hidden className="bg-series-3/15 text-series-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <LevelIcon level={level?.level ?? 1} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate font-semibold">{level ? level.name : 'Missões'}</span>
          <span className="text-muted block text-xs">{level ? `Nível ${level.level}` : ' '}</span>
        </span>
        <ChevronRight aria-hidden className="text-muted h-4 w-4 shrink-0" />
      </Link>

      {!status || !level ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <LevelBar level={level} />
          {next.length > 0 ? (
            <ul className="-mx-1 flex flex-col">
              {next.map((mission) => (
                <MissionRow key={mission.key} mission={mission} onGo={go} />
              ))}
            </ul>
          ) : (
            <p className="text-muted text-sm">Tudo feito por agora.</p>
          )}
          {status.fact && <FactLine fact={status.fact} className="border-border border-t pt-3" />}
        </>
      )}
    </section>
  );
}
