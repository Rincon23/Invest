'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatMonthShort } from '@/lib/budget/date';
import { isMeetMission, type MissionState } from '@/lib/gamification/missions';
import { PageHeader } from '@/components/layout/PageHeader';
import { LevelBar, MissionRow } from '@/components/missions/MissionParts';
import { useMissions } from '@/components/missions/MissionsProvider';
import { LevelIcon } from '@/components/missions/levelVisuals';
import { useMissionAction } from '@/components/missions/useMissionAction';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton } from '@/components/modules/ModuleHelpButton';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { Skeleton } from '@/components/modules/home/HomeCard';

export function MissoesScreen() {
  return (
    <ModuleGate module="missions">
      <Missoes />
    </ModuleGate>
  );
}

const done = (missions: MissionState[]) => missions.filter((mission) => mission.done).length;

/**
 * Missões: the level on top (its tree, its name and the bar to the next one), then the missions —
 * the first-time ones, the month's, the week's and the day's, and "Conhecer os módulos" folded —
 * and the XP of each of the last months.
 */
function Missoes() {
  const backHref = useHomeHref();
  const { status, level } = useMissions();
  const go = useMissionAction();
  const [meetOpen, setMeetOpen] = useState(false);

  const missions = status?.missions ?? [];
  const firstTime = missions.filter((mission) => mission.period === 'once' && !isMeetMission(mission.key));
  const month = missions.filter((mission) => mission.period === 'month');
  const week = missions.filter((mission) => mission.period === 'week');
  const day = missions.filter((mission) => mission.period === 'day');
  const meet = missions.filter((mission) => isMeetMission(mission.key));
  // First-time missions all done: they go to the end, out of the way.
  const firstTimeDone = firstTime.length > 0 && done(firstTime) === firstTime.length;

  const section = (title: string, list: MissionState[]) =>
    list.length > 0 && (
      <section className="border-border bg-card flex flex-col gap-1 rounded-2xl border p-3 shadow-sm">
        <h2 className="text-muted flex items-center justify-between px-3 pt-1 pb-1 text-xs font-semibold tracking-wide uppercase">
          <span>{title}</span>
          <span className="tabular-nums">
            {done(list)} de {list.length}
          </span>
        </h2>
        <ul className="flex flex-col">
          {list.map((mission) => (
            <MissionRow key={mission.key} mission={mission} onGo={go} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      <PageHeader title="Missões" backHref={backHref} action={<ModuleHelpButton module="missions" />} />

      <section
        data-tour="missoes-nivel"
        className="border-border bg-card mx-4 flex flex-col items-center gap-3 rounded-2xl border p-5 text-center shadow-sm"
      >
        <span aria-hidden className="bg-series-3/15 text-series-3 flex h-20 w-20 items-center justify-center rounded-full">
          <LevelIcon level={level?.level ?? 1} className="h-10 w-10" />
        </span>
        {level ? (
          <>
            <div>
              <p className="text-muted text-sm font-medium">Nível {level.level}</p>
              <p className="text-foreground text-2xl font-bold">{level.name}</p>
            </div>
            <div className="w-full">
              <LevelBar level={level} />
            </div>
          </>
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </section>

      <div data-tour="missoes-lista" className="mx-4 flex flex-col gap-4">
        {!firstTimeDone && section('Primeira vez', firstTime)}
        {section('Este mês', month)}
        {section('Esta semana', week)}
        {section('Hoje', day)}
        {meet.length > 0 && (
          <section className="border-border bg-card flex flex-col gap-1 rounded-2xl border p-3 shadow-sm">
            <button
              type="button"
              onClick={() => setMeetOpen((open) => !open)}
              aria-expanded={meetOpen}
              className="text-muted flex min-h-[40px] items-center justify-between px-3 text-xs font-semibold tracking-wide uppercase"
            >
              <span>Conhecer os módulos</span>
              <span className="flex items-center gap-2 tabular-nums">
                {done(meet)} de {meet.length}
                <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${meetOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {meetOpen && (
              <ul className="flex flex-col">
                {meet.map((mission) => (
                  <MissionRow key={mission.key} mission={mission} onGo={go} />
                ))}
              </ul>
            )}
          </section>
        )}
        {firstTimeDone && section('Primeira vez', firstTime)}
      </div>

      {status && status.months.length > 0 && (
        <section className="border-border bg-card mx-4 flex flex-col gap-2 rounded-2xl border p-4 shadow-sm">
          <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">XP por mês</h2>
          <ul className="flex flex-col gap-1">
            {status.months.map((item) => (
              <li key={item.month} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{formatMonthShort(item.month)}</span>
                <span className="text-foreground font-semibold tabular-nums">{item.xp} XP</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
