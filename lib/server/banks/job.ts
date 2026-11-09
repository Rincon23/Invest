import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { mayUseModule } from '@/lib/modules';
import { userAccess } from '../access';
import { bankKeys, budgetSettings, user } from '../db/schema';
import type { Database } from '../db/types';
import { lastRun, markRun } from '../jobRuns';
import { syncAndNotify, type AlertDeps } from './alerts';
import type { FetchLike } from './pluggy';
import type { BankSyncResult } from './service';

/**
 * Open Finance in the background: once an hour, every VIP with the module on and a saved key has
 * their banks read (lib/server/banks/service.ts `syncUser`) and gets the alerts of what arrived
 * (./alerts.ts). Pluggy updates each bank once a day, so most hours only ask "anything new?".
 */

const BANKS_JOB = 'banks';
const EVERY_MS = 60 * 60 * 1000;

export interface BanksJobResult {
  people: number;
  /** Per person, what each bank brought (the alerts of F4 read this). */
  results: { userId: string; banks: BankSyncResult[] }[];
}

export async function runBanksJob(
  db: Database,
  now: Date = new Date(),
  fetchImpl: FetchLike = fetch,
  deps: AlertDeps = {},
): Promise<BanksJobResult> {
  const previous = await lastRun(db, BANKS_JOB);
  if (previous && now.getTime() - previous.getTime() < EVERY_MS) return { people: 0, results: [] };
  await markRun(db, BANKS_JOB, now);

  const people = await db
    .select({ userId: bankKeys.userId, email: user.email })
    .from(bankKeys)
    .innerJoin(budgetSettings, eq(budgetSettings.userId, bankKeys.userId))
    .innerJoin(user, eq(user.id, bankKeys.userId))
    .where(sql`coalesce((${budgetSettings.modules}->>'banks')::boolean, true)`);

  const results: BanksJobResult['results'] = [];
  for (const { userId, email } of people) {
    try {
      // While "Só VIP": someone whose VIP was taken back keeps the data, but nothing is read for them.
      if (!mayUseModule(await userAccess(db, userId, email), 'banks')) continue;
      const banks = await syncAndNotify(db, userId, fetchImpl, now, deps);
      if (banks) results.push({ userId, banks });
    } catch (err) {
      console.error('[bancos] falha ao ler os bancos de uma conta:', err instanceof Error ? err.message : err);
    }
  }
  return { people: people.length, results };
}
