'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { currentMonthKey, previousMonth } from '@/lib/budget/date';
import type { ModuleKey, Month } from '@/lib/budget/types';
import type { MissionKey, MissionState } from '@/lib/gamification/missions';
import { moduleDefinition } from '@/lib/modules';
import { useTour } from '@/components/modules/tour/TourProvider';

/** Where a mission takes the person, and the one button there that does it (highlighted). */
export interface MissionTarget {
  href: string;
  anchor?: string;
  side?: 'top' | 'bottom';
}

/** The place of each mission. */
export function missionTarget(key: MissionKey, month: Month): MissionTarget | null {
  const entries = `/mes/${month}/lancamentos`;
  switch (key) {
    // The XP of the day is claimed only on the Início, on the Missões bar.
    case 'open-app':
      return { href: `/mes/${month}`, anchor: 'missoes-resgatar', side: 'bottom' };
    case 'first-income':
    case 'month-income':
      return { href: entries, anchor: 'fab-renda', side: 'top' };
    case 'first-expense':
    case 'month-expense':
      return { href: entries, anchor: 'fab-lancar-gasto', side: 'top' };
    case 'setup-categories':
      return { href: `/mes/${month}/categorias?ajustar=1` };
    case 'first-reminder':
      return { href: '/lembretes', anchor: 'lembretes-novo', side: 'top' };
    case 'enable-push':
      return { href: '/notificacoes' };
    case 'install-app':
      return { href: '/configuracoes', anchor: 'instalar-app', side: 'top' };
    case 'connect-bank':
      return { href: '/bancos', anchor: 'bancos-conexoes', side: 'bottom' };
    case 'check-banks':
      return { href: '/bancos/conferir' };
    case 'check-calendar':
      return { href: '/lembretes?aba=calendario' };
    case 'check-recurring':
      return { href: '/carteira/recorrentes' };
    case 'check-card':
      return { href: '/cartao' };
    case 'check-reserve':
      return { href: '/carteira/caixa' };
    case 'close-month':
      return { href: `/mes/${previousMonth(month)}/categorias`, anchor: 'fechar-mes', side: 'top' };
  }
  const moduleKey = key.slice('meet-'.length) as ModuleKey;
  if (moduleKey === 'reimbursable') return { href: `${entries}?aba=a-receber` };
  const screen = moduleDefinition(moduleKey).screen;
  return screen ? { href: screen.href(month) } : null;
}

/**
 * What a tap on a mission does: goes to its place and, when there is one button to tap there,
 * highlights it (one step of the spotlight, which the tap on the button closes). Only ever on a
 * tap: nothing here starts by itself.
 */
export function useMissionAction(): (mission: MissionState) => void {
  const router = useRouter();
  const { startSteps } = useTour();
  return useCallback(
    (mission: MissionState) => {
      const target = missionTarget(mission.key, currentMonthKey());
      if (!target) return;
      if (!target.anchor) {
        router.push(target.href);
        return;
      }
      startSteps(
        [{ href: target.href, anchor: target.anchor, title: mission.title, description: 'Toque aqui.', side: target.side }],
        { stay: true },
      );
    },
    [router, startSteps],
  );
}
