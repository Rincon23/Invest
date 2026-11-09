import { eq } from 'drizzle-orm';
import { jobRuns } from './db/schema';
import type { Database } from './db/types';

/**
 * When each background job last ran. Every job remembers it, so after a restart it catches up
 * on what it missed instead of skipping it (see `lib/server/scheduler.ts`).
 */

/** After a longer outage, notifications older than this are dropped rather than sent late. */
export const MAX_CATCH_UP_MS = 12 * 60 * 60 * 1000;

export async function lastRun(db: Database, name: string): Promise<Date | null> {
  const [row] = await db.select().from(jobRuns).where(eq(jobRuns.name, name));
  return row?.lastRunAt ?? null;
}

export async function markRun(db: Database, name: string, at: Date): Promise<void> {
  await db
    .insert(jobRuns)
    .values({ name, lastRunAt: at })
    .onConflictDoUpdate({ target: jobRuns.name, set: { lastRunAt: at } });
}

/**
 * The start of the window a notification job has to cover: from its last run (at most
 * MAX_CATCH_UP_MS back), or the previous minute the first time it ever runs.
 */
export async function catchUpFrom(db: Database, name: string, now: Date): Promise<Date> {
  const previous = await lastRun(db, name);
  return previous
    ? new Date(Math.max(previous.getTime(), now.getTime() - MAX_CATCH_UP_MS))
    : new Date(now.getTime() - 60_000);
}
