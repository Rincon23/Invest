import { eq } from 'drizzle-orm';
import { migrateReserveModule } from '../modules/migration';
import { budgetSettings, jobRuns } from './db/schema';
import type { Database } from './db/types';

/**
 * Brings every existing account over to the single "Reserva" module ("Reserva de emergência" and
 * "Reserva investida" merged, see `migrateReserveModule`). It runs once, on the first start after
 * the update (a row in `job_runs` is the marker): whoever had the invested reserve on now has
 * Reserva on, and the old key leaves the Início (pages, hidden widgets, sizes) and the old bottom
 * bar, turned into `cash` in the same position. The quotas and categories themselves are not
 * touched — they never belonged to the module, only to the account.
 */

export const RESERVE_MODULE_MIGRATION_JOB = 'reserve-module-merge';

export async function runReserveModuleMigration(
  db: Database,
  now: Date = new Date(),
): Promise<{ skipped: boolean; accounts: number }> {
  const marked = await db
    .insert(jobRuns)
    .values({ name: RESERVE_MODULE_MIGRATION_JOB, lastRunAt: now })
    .onConflictDoNothing()
    .returning({ name: jobRuns.name });
  if (marked.length === 0) return { skipped: true, accounts: 0 };

  const rows = await db
    .select({
      userId: budgetSettings.userId,
      modules: budgetSettings.modules,
      nav: budgetSettings.nav,
      homeOrder: budgetSettings.homeOrder,
      homePages: budgetSettings.homePages,
      homeHidden: budgetSettings.homeHidden,
      homeCardSizes: budgetSettings.homeCardSizes,
    })
    .from(budgetSettings);

  let accounts = 0;
  for (const row of rows) {
    const next = migrateReserveModule(row);
    if (!next.changed) continue;
    await db
      .update(budgetSettings)
      .set({
        modules: next.modules,
        nav: next.nav,
        homeOrder: next.homeOrder,
        homePages: next.homePages,
        homeHidden: next.homeHidden,
        homeCardSizes: next.homeCardSizes,
      })
      .where(eq(budgetSettings.userId, row.userId));
    accounts += 1;
  }

  if (accounts > 0) console.info(`[reserva] as duas reservas viraram uma em ${accounts} conta(s).`);
  return { skipped: false, accounts };
}
