import { eq } from 'drizzle-orm';
import { PostgresBudgetRepository } from './budgetRepository';
import { jobRuns, months } from './db/schema';
import type { Database } from './db/types';

/**
 * Leftovers used to go on to the next month by themselves; now only a closed month passes them on
 * (`carrySource`). Every account's months are recomputed once, on the first start after the update,
 * so months still open stop feeding the next ones right away and not on the next write to them.
 * Closing those months brings the same numbers back. A row in `job_runs` marks it as done, written
 * last: recomputing is harmless, so a start that fails halfway simply does it all again.
 */

export const CARRY_ON_CLOSE_JOB = 'carry-on-close';

export async function runCarryOnCloseMigration(
  db: Database,
  now: Date = new Date(),
): Promise<{ skipped: boolean; accounts: number }> {
  const [done] = await db.select().from(jobRuns).where(eq(jobRuns.name, CARRY_ON_CLOSE_JOB));
  if (done) return { skipped: true, accounts: 0 };

  const accounts = await db.selectDistinct({ userId: months.userId }).from(months);
  for (const { userId } of accounts) await new PostgresBudgetRepository(db, userId).recascadeAll();

  await db.insert(jobRuns).values({ name: CARRY_ON_CLOSE_JOB, lastRunAt: now }).onConflictDoNothing();
  console.info(`[orçamento] sobra só com o mês fechado: ${accounts.length} conta(s) recalculada(s).`);
  return { skipped: false, accounts: accounts.length };
}
