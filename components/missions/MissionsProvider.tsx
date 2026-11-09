'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { levelOf, type LevelProgress } from '@/lib/gamification/levels';
import {
  missionDefinition,
  visitsForPath,
  type MissionKey,
  type MissionsStatus,
} from '@/lib/gamification/missions';
import { DATA_CHANGED_EVENT } from '@/lib/storage/apiClient';
import { checkMissions } from '@/lib/storage/missions';
import { useTour } from '@/components/modules/tour/TourProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { LevelUpCard } from './LevelUpCard';
import { WelcomeCard } from './WelcomeCard';
import { centerOf, flyXp, xpTarget, type ScreenPoint } from './xpFlight';

interface MissionsContextValue {
  /** Null until the first check comes back. */
  status: MissionsStatus | null;
  /** The level on screen: while XP is flying to the tree, without it, so the bar fills as it lands. */
  level: LevelProgress | null;
  /** Some XP is on its way to the tree. */
  landing: boolean;
  /** Reports a mission done by going somewhere that is not a screen of its own (a tab, a sheet). */
  visit: (key: MissionKey) => void;
  /**
   * "Resgatar" on the Início: the XP of the day. Opening the app alone no longer gives it. `from`
   * is the button, where the XP flies out of.
   */
  claimDay: (from?: Element) => void;
}

const MissionsContext = createContext<MissionsContextValue | null>(null);

/** How long after a save the missions are checked: a burst of saves becomes one check. */
const AFTER_SAVE_MS = 700;

/** The dismissed notice that says the account already had its welcome. */
const WELCOME_NOTICE = 'welcome:missions';

/** A tap this recent is where the XP of what it did flies out of (a save, then the check). */
const TAP_MEMORY_MS = 5000;

const installed = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * The Missões of the signed-in account (lib/gamification/missions.ts). It checks them when the app
 * opens, when it comes back to the screen, after anything is saved, on every screen visited and on
 * "Resgatar" (the XP of the day) — the server gives the XP, once per period. What was just earned
 * flies as "+30 XP" from where the person tapped into the tree of the Missões bar, when the tree is
 * on screen (xpFlight.ts), or else shows as a toast ("+30 XP · Lançar um gasto"); a new level as a
 * card with its name, and the very first open of a new account as the welcome (WelcomeCard), once
 * per account.
 */
export function MissionsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { showToast } = useToast();
  const { isTourActive } = useTour();
  const { settings, saveSettings } = useSettings();
  const [status, setStatus] = useState<MissionsStatus | null>(null);
  const [levelUp, setLevelUp] = useState<LevelProgress | null>(null);
  /** The first check found a new account; the welcome waits for the settings to know if it had one. */
  const [newAccount, setNewAccount] = useState(false);
  const [welcome, setWelcome] = useState(false);
  /** The XP flying to the tree right now, not on the bar yet. */
  const [inFlight, setInFlight] = useState(0);
  const lastTap = useRef<(ScreenPoint & { at: number }) | null>(null);
  const statusRef = useRef<MissionsStatus | null>(null);
  const pending = useRef<Set<MissionKey>>(new Set());
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** A toast waits while a spotlight is up: it would cover the very button being pointed at. */
  const toast = useCallback(
    (message: string) => {
      const show = (tries: number) => {
        if (isTourActive() && tries > 0) setTimeout(() => show(tries - 1), 500);
        else showToast(message, 'success');
      };
      show(60);
    },
    [isTourActive, showToast],
  );

  /**
   * Sends `xp` flying into the tree, from the last tap (or the bottom of the screen); `landed` runs
   * when it gets there. False when it cannot fly (no tree on screen, a spotlight up, less motion).
   */
  const fly = useCallback(
    (xp: number, landed: () => void): boolean => {
      const target = isTourActive() ? null : xpTarget();
      if (!target) return false;
      const tap = lastTap.current && Date.now() - lastTap.current.at < TAP_MEMORY_MS ? lastTap.current : null;
      const flight = flyXp(xp, tap ?? { x: window.innerWidth / 2, y: window.innerHeight - 120 }, target);
      if (!flight) return false;
      lastTap.current = null;
      setInFlight((total) => total + xp);
      void flight.then(() => {
        setInFlight((total) => total - xp);
        landed();
      });
      return true;
    },
    [isTourActive],
  );

  const celebrate = useCallback(
    (before: MissionsStatus | null, after: MissionsStatus) => {
      const total = after.earned.reduce((sum, item) => sum + item.xp, 0);
      // A brand-new account (whatever XP it has, often none, is what it just got by arriving): the welcome.
      if (!before && after.xp === total && after.earned.length < 3) {
        setNewAccount(true);
        return;
      }
      if (total === 0) return;
      const level = levelOf(after.xp);
      // The first check of an account that already did things: one notice, not a party per mission.
      if (!before && after.earned.length >= 3) {
        toast(`Você já tinha ${after.xp} XP · ${level.name}`);
        return;
      }
      // On the first check since the app loaded there is no `before`: what it had is what it has
      // now minus what it just got.
      const leveledUp = levelOf(before?.xp ?? after.xp - total).level < level.level;
      // The new level once the XP is in the tree, not over it mid-flight.
      if (fly(total, () => leveledUp && setLevelUp(level))) return;
      const title = after.earned.length === 1 ? missionDefinition(after.earned[0].key)?.title : null;
      toast(`+${total} XP · ${title ?? `${after.earned.length} missões`}`);
      if (leveledUp) setLevelUp(level);
    },
    [fly, toast],
  );

  /** One check at a time; one asked for meanwhile runs right after, with what piled up. */
  const run = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        const visits = [...pending.current];
        pending.current.clear();
        try {
          const next = await checkMissions(visits);
          const before = statusRef.current;
          statusRef.current = next;
          setStatus(next);
          celebrate(before, next);
        } catch {
          // Offline or a hiccup: what the data shows the next check catches up by itself, and the
          // visits wait for it — the server never heard of them.
          for (const key of visits) pending.current.add(key);
        }
      } while (again.current);
    } finally {
      running.current = false;
    }
  }, [celebrate]);

  const schedule = useCallback(
    (delay: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), delay);
    },
    [run],
  );

  /**
   * Queues visits worth sending: not done yet, and missions the account has (once that is known).
   * With `fresh`, the status may be from another day (the app was left open overnight, or into a
   * new month) and its "done" no longer holds: everything goes, the server keeps it to once.
   */
  const queue = useCallback((keys: MissionKey[], { fresh = false }: { fresh?: boolean } = {}) => {
    const current = statusRef.current;
    const worth = keys.filter(
      (key) => fresh || !current || current.missions.some((mission) => mission.key === key && !mission.done),
    );
    for (const key of worth) pending.current.add(key);
    return worth.length > 0;
  }, []);

  // The welcome, once per account: an account that never earns anything is still new on every open.
  useEffect(() => {
    if (!newAccount || !settings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewAccount(false);
    if (settings.dismissedNotices?.includes(WELCOME_NOTICE)) return;
    setWelcome(true);
    void saveSettings({ ...settings, dismissedNotices: [...(settings.dismissedNotices ?? []), WELCOME_NOTICE] }).catch(
      () => {},
    );
  }, [newAccount, settings, saveSettings]);

  // Opening the app: the installed app, and the screen it opened on (the XP of the day is "Resgatar").
  useEffect(() => {
    queue(installed() ? ['install-app'] : []);
    schedule(0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [queue, schedule]);

  // Every screen visited: the first visit to a module, the month's checks.
  useEffect(() => {
    if (queue(visitsForPath(pathname, window.location.search))) schedule(statusRef.current ? 0 : 50);
  }, [pathname, queue, schedule]);

  // After a save, and when the app comes back to the screen (maybe on another day).
  useEffect(() => {
    const afterSave = () => schedule(AFTER_SAVE_MS);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // An installed app comes back from memory, often on another day: the screen it is on counts
      // again whatever the old status says, and the new status brings back "Resgatar".
      queue(visitsForPath(window.location.pathname, window.location.search), { fresh: true });
      schedule(0);
    };
    window.addEventListener(DATA_CHANGED_EVENT, afterSave);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, afterSave);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [queue, schedule]);

  const visit = useCallback(
    (key: MissionKey) => {
      if (queue([key])) schedule(0);
    },
    [queue, schedule],
  );

  // Where the XP of what a tap does flies out of: the tap itself.
  useEffect(() => {
    const onTap = (event: PointerEvent) => {
      lastTap.current = { x: event.clientX, y: event.clientY, at: Date.now() };
    };
    window.addEventListener('pointerdown', onTap, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', onTap, { capture: true });
  }, []);

  // Sent even if the status says done: it may be from yesterday (the server keeps it to once a day).
  const claimDay = useCallback(
    (from?: Element) => {
      if (from) lastTap.current = { ...centerOf(from), at: Date.now() };
      pending.current.add('open-app');
      schedule(0);
    },
    [schedule],
  );

  const value = useMemo(
    () => ({
      status,
      level: status ? levelOf(Math.max(0, status.xp - inFlight)) : null,
      landing: inFlight > 0,
      visit,
      claimDay,
    }),
    [status, inFlight, visit, claimDay],
  );

  return (
    <MissionsContext.Provider value={value}>
      {children}
      {levelUp && <LevelUpCard level={levelUp} onClose={() => setLevelUp(null)} />}
      {welcome && status && <WelcomeCard status={status} onClose={() => setWelcome(false)} />}
    </MissionsContext.Provider>
  );
}

const OUTSIDE: MissionsContextValue = { status: null, level: null, landing: false, visit: () => {}, claimDay: () => {} };

/** The Missões of the account; outside the signed-in app (a test, a lone sheet), nothing happens. */
export function useMissions(): MissionsContextValue {
  return useContext(MissionsContext) ?? OUTSIDE;
}
