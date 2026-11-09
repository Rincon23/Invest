import { eq, sql } from 'drizzle-orm';
import { budgetSettings, jobRuns } from './db/schema';
import type { Database } from './db/types';

/**
 * The default name of the fixed-cost category went from "Custo Fixo" to "Custos Fixos" — it is
 * one category holding many costs, and the singular read like a single bill. Renaming the
 * default alone would leave every account already created stuck on the old word, so this runs
 * once on the first start after the update (a row in `job_runs` is the marker).
 *
 * It only touches accounts that still carry the exact old default: anyone who renamed the
 * category to something of their own keeps it, because that name is theirs, not ours.
 */

export const FIXED_COST_LABEL_JOB = 'fixed-cost-plural';

const OLD_LABEL = 'Custo Fixo';
const NEW_LABEL = 'Custos Fixos';

export async function runFixedCostLabelMigration(
  db: Database,
  now: Date = new Date(),
): Promise<{ skipped: boolean; accounts: number }> {
  const marked = await db
    .insert(jobRuns)
    .values({ name: FIXED_COST_LABEL_JOB, lastRunAt: now })
    .onConflictDoNothing()
    .returning({ name: jobRuns.name });
  if (marked.length === 0) return { skipped: true, accounts: 0 };

  const updated = await db
    .update(budgetSettings)
    .set({
      specialCategories: sql`jsonb_set(${budgetSettings.specialCategories}::jsonb, '{fixedCost}', ${JSON.stringify(NEW_LABEL)}::jsonb)`,
    })
    .where(eq(sql`${budgetSettings.specialCategories}->>'fixedCost'`, OLD_LABEL))
    .returning({ userId: budgetSettings.userId });

  if (updated.length > 0) {
    console.info(`[categorias] "${OLD_LABEL}" virou "${NEW_LABEL}" em ${updated.length} conta(s).`);
  }
  return { skipped: false, accounts: updated.length };
}
