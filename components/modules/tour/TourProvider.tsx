'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import '@/components/onboarding/tour.css';
import type { ModuleKey } from '@/lib/budget';
import { useLastViewedMonth } from '@/lib/hooks/useLastViewedMonth';
import { HOME_NAV, isModuleOn, tourSteps, type TourStep } from '@/lib/modules';
import { useSettings } from '@/components/providers/SettingsProvider';
import { revealOnHome } from './homeReveal';
import { requestTourSheet } from './tourSheets';

interface TourContextValue {
  /** Runs the tour of these modules, on the real screens, and comes back to where it started. */
  startTour: (modules: ModuleKey[]) => void;
  /**
   * Runs these steps (a tour that is not a module's, like organizing the Início). With `stay`, it
   * does not go back to where it started, and tapping what is highlighted closes it: a mission
   * leading the person to the button they have to tap.
   */
  startSteps: (steps: TourStep[], options?: { stay?: boolean }) => void;
  /** Whether a tour is on screen right now. */
  isTourActive: () => boolean;
}

const TourContext = createContext<TourContextValue | null>(null);

/** How long a step waits for its screen (and its element) to show up after navigating. */
const WAIT_FOR_ELEMENT_MS = 8000;

/**
 * The tour engine: a spotlight (driver.js, with the app's look from tour.css) that darkens the
 * screen and cuts out what is being explained. It takes any list of steps from the modules'
 * tours, navigates between their screens and opens the sheets a step needs.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const month = useLastViewedMonth();
  const { settings } = useSettings();
  const active = useRef<Driver | null>(null);
  useEffect(() => () => active.current?.destroy(), []);

  const startSteps = useCallback(
    (steps: TourStep[], { stay = false }: { stay?: boolean } = {}) => {
      active.current?.destroy();
      if (steps.length === 0) return;

      const origin = `${window.location.pathname}${window.location.search}`;
      let current = -1;
      let finished = false;

      const here = () => `${window.location.pathname}${window.location.search}`;

      /** Leaves step `current` and prepares step `index`: its screen and its sheet. */
      const prepare = (index: number) => {
        const from: TourStep | undefined = steps[current];
        const to = steps[index];
        if (from?.sheet && from.sheet !== to.sheet) requestTourSheet('close');
        if (to.href !== here()) router.push(to.href);
        if (to.sheet && to.sheet !== from?.sheet) requestTourSheet(to.sheet);
        // A widget of the Início may sit on another área de trabalho: the Início switches to it first.
        if (HOME_NAV.isActive(to.href.split('?')[0])) revealOnHome(to.anchor);
        current = index;
      };

      /**
       * Runs `then` once the step's screen is the one on screen. The screen being left may have an
       * element with the same name (the Início has its own "Renda" on the way to Lançamentos), and
       * the spotlight would land on it and stay there, pointing at nothing, once that screen goes.
       */
      const onScreen = (href: string, then: () => void) => {
        const giveUp = Date.now() + WAIT_FOR_ELEMENT_MS;
        const check = () => {
          if (finished || active.current !== tour) return;
          if (here() === href || Date.now() > giveUp) then();
          else setTimeout(check, 50);
        };
        check();
      };

      const finish = () => {
        if (finished) return;
        finished = true;
        if (steps[current]?.sheet) requestTourSheet('close');
        revealOnHome(null);
        tour.destroy();
        active.current = null;
        if (!stay && here() !== origin) router.push(origin);
      };

      const tour: Driver = driver({
        showProgress: steps.length > 1,
        // One step has nowhere to go back to.
        ...(steps.length === 1 ? { showButtons: ['next' as const, 'close' as const] } : {}),
        progressText: '{{current}} de {{total}}',
        allowClose: true,
        overlayOpacity: 0.7,
        stageRadius: 12,
        stagePadding: 6,
        waitForElement: WAIT_FOR_ELEMENT_MS,
        popoverClass: 'capital-tour-popover',
        nextBtnText: 'Próximo',
        prevBtnText: 'Voltar',
        doneBtnText: 'Entendi',
        steps: steps.map((step, index) => ({
          element: `[data-tour="${step.anchor}"]`,
          popover: {
            title: step.title,
            description: step.description,
            side: step.side,
            onNextClick: () => {
              if (index === steps.length - 1) return finish();
              prepare(index + 1);
              onScreen(steps[index + 1].href, () => tour.moveTo(index + 1));
            },
            onPrevClick: () => {
              if (index === 0) return;
              prepare(index - 1);
              onScreen(steps[index - 1].href, () => tour.moveTo(index - 1));
            },
          },
        })),
        onDestroyStarted: finish,
        // Leading somewhere: the tap on the highlighted button is the point, and it ends the spotlight.
        ...(stay
          ? {
              onHighlighted: (element?: Element) =>
                element?.addEventListener('click', () => finish(), { once: true, capture: true }),
            }
          : {}),
      });

      active.current = tour;
      prepare(0);
      onScreen(steps[0].href, () => tour.drive(0));
    },
    [router],
  );

  const startTour = useCallback(
    (modules: ModuleKey[]) => {
      // Month screens carry the month in the URL; the tour uses the one on screen, if any.
      const monthOnScreen = window.location.pathname.match(/^\/mes\/([\d-]+)/)?.[1] ?? month;
      // A step about another module's part of the screen only when that module is on.
      startSteps(tourSteps(modules, monthOnScreen, (key) => !!settings && isModuleOn(settings, key)));
    },
    [month, settings, startSteps],
  );

  const isTourActive = useCallback(() => active.current !== null, []);

  const value = useMemo(
    () => ({ startTour, startSteps, isTourActive }),
    [startTour, startSteps, isTourActive],
  );
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour deve ser usado dentro de TourProvider');
  return ctx;
}
