import { FEATURE_ANNOUNCEMENTS } from '../notifications/announcements';
import { runAnnouncementsJob, runMissingNameJob } from './announcements';
import { runBanksJob } from './banks/job';
import type { Database } from './db/types';
import { markRun } from './jobRuns';

/**
 * The background jobs, run inside the Invest + server itself (no extra container): once a minute,
 * a little after the minute turns. Every job remembers when it last ran (`job_runs`), so after a
 * restart it catches up on what it missed instead of skipping it.
 */

/** Marked on every round, so the automatic tests can tell the loop is alive. */
export const SCHEDULER_HEARTBEAT = 'scheduler';

const globalForScheduler = globalThis as unknown as { investSchedulerStarted?: boolean };

/** Whether this server process runs the background jobs (the automatic tests check they keep up). */
export function schedulerRunning(): boolean {
  return globalForScheduler.investSchedulerStarted === true;
}

/** Seconds past the minute the jobs run at. */
const TICK_OFFSET_MS = 5_000;

/**
 * Starts the minute loop once per server process (dev hot reloads included). Set SCHEDULER=off
 * in the environment to run a server without background jobs.
 */
export function startScheduler(getDb: () => Database): void {
  if (globalForScheduler.investSchedulerStarted || process.env.SCHEDULER === 'off') return;
  globalForScheduler.investSchedulerStarted = true;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const db = getDb();
      await markRun(db, SCHEDULER_HEARTBEAT, new Date());
      await runBanksJob(db).catch((err) => console.error('[bancos] falha na leitura:', err));
      await runAnnouncementsJob(db, FEATURE_ANNOUNCEMENTS).catch((err) =>
        console.error('[novidades] falha ao notificar:', err),
      );
      await runMissingNameJob(db).catch((err) => console.error('[nome] falha ao avisar:', err));
    } catch (err) {
      console.error('[agenda] falha na rodada:', err);
    } finally {
      running = false;
    }
  };

  const scheduleNext = () => {
    const delay = 60_000 - (Date.now() % 60_000) + TICK_OFFSET_MS;
    setTimeout(() => {
      void tick();
      scheduleNext();
    }, delay).unref?.();
  };
  scheduleNext();
  console.log('[agenda] bancos em segundo plano ativados.');
}
