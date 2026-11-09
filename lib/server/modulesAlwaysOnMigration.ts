import { eq } from 'drizzle-orm';
import { budgetSettings, jobRuns, user } from './db/schema';
import type { Database } from './db/types';
import { homeTemplate, homeTemplateEmail } from './homeTemplate';

/**
 * Brings every account over to the app without module switches (every module on, but the
 * restricted ones): once, every account but the owner's and the template's gets the template's
 * Início (lib/server/homeTemplate.ts: the template account's, or the owner's while there is none)
 * — its telas, order and sizes, with **every widget showing**: the owner's choice was that only
 * the restricted modules stay out of sight, and those leave by themselves for an account without
 * access. Afterwards each person
 * changes and removes what they want. Without any template yet (no `OWNER_EMAIL`), this waits for
 * a later start. A row in `job_runs` marks it as done.
 *
 * The switches themselves are written by `syncModules`, which runs on every start right after.
 */

export const HOME_TEMPLATE_RESET_JOB = 'home-template-reset';

export async function runModulesAlwaysOnMigration(db: Database, now: Date = new Date()): Promise<{ reset: number }> {
  const template = await homeTemplate(db);
  if (!template) return { reset: 0 };
  const marked = await db
    .insert(jobRuns)
    .values({ name: HOME_TEMPLATE_RESET_JOB, lastRunAt: now })
    .onConflictDoNothing()
    .returning({ name: jobRuns.name });
  if (marked.length === 0) return { reset: 0 };

  const keep = new Set([process.env.OWNER_EMAIL?.trim().toLowerCase(), homeTemplateEmail()]);
  const rows = await db
    .select({ userId: budgetSettings.userId, email: user.email })
    .from(budgetSettings)
    .innerJoin(user, eq(user.id, budgetSettings.userId));
  let reset = 0;
  for (const row of rows) {
    if (keep.has(row.email.toLowerCase())) continue;
    await db
      .update(budgetSettings)
      .set({ homePages: template.homePages, homeOrder: null, homeHidden: [], homeCardSizes: template.homeCardSizes })
      .where(eq(budgetSettings.userId, row.userId));
    reset += 1;
  }
  console.info(`[módulos] todos ligados: ${reset} conta(s) com a Início padrão.`);
  return { reset };
}
