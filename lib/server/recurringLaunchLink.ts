import { and, eq, isNull } from 'drizzle-orm';
import { expenses, jobRuns, recurringExpenses } from './db/schema';
import type { Database } from './db/types';

/**
 * "Contas do mês" knows a bill was launched because the expense points at its template
 * (`expenses.recurring_id`). The expenses launched from a template before that existed only say
 * `source = 'recurring'`, so without care every bill already launched this month would show up
 * again as still to launch — and launching it again would count it twice.
 *
 * This runs once, on the first start after the update (a row in `job_runs` is the marker), and
 * links each of those expenses to its template, but only where the match is unambiguous: the
 * same description and the same category as exactly one template of that person. Anything else
 * is left as it is — inventing a link is worse than not having one, and the person can still tie
 * an expense to its bill by hand ("Já lancei").
 */

export const RECURRING_LAUNCH_LINK_JOB = 'recurring-launch-link';

export async function runRecurringLaunchLink(
  db: Database,
  now: Date = new Date(),
): Promise<{ skipped: boolean; linked: number }> {
  const marked = await db
    .insert(jobRuns)
    .values({ name: RECURRING_LAUNCH_LINK_JOB, lastRunAt: now })
    .onConflictDoNothing()
    .returning({ name: jobRuns.name });
  if (marked.length === 0) return { skipped: true, linked: 0 };

  const templates = await db
    .select({
      userId: recurringExpenses.userId,
      id: recurringExpenses.id,
      description: recurringExpenses.description,
      categoryKind: recurringExpenses.categoryKind,
      topicId: recurringExpenses.topicId,
    })
    .from(recurringExpenses);
  const byKey = new Map<string, string[]>();
  const keyOf = (row: { userId: string; description: string; categoryKind: string; topicId: string | null }) =>
    [row.userId, row.description.trim().toLowerCase(), row.categoryKind, row.topicId ?? ''].join('\u0000');
  for (const template of templates) {
    const key = keyOf(template);
    byKey.set(key, [...(byKey.get(key) ?? []), template.id]);
  }

  const launched = await db
    .select({
      userId: expenses.userId,
      id: expenses.id,
      description: expenses.description,
      categoryKind: expenses.categoryKind,
      topicId: expenses.topicId,
    })
    .from(expenses)
    .where(and(eq(expenses.source, 'recurring'), isNull(expenses.recurringId)));

  let linked = 0;
  for (const expense of launched) {
    const matches = byKey.get(keyOf(expense)) ?? [];
    if (matches.length !== 1) continue;
    await db
      .update(expenses)
      .set({ recurringId: matches[0] })
      .where(and(eq(expenses.userId, expense.userId), eq(expenses.id, expense.id)));
    linked += 1;
  }

  if (linked > 0) console.info(`[contas do mês] ${linked} gasto(s) ligado(s) à conta de onde vieram.`);
  return { skipped: false, linked };
}
