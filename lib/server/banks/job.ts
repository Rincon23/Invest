import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { mayUseModule } from '@/lib/modules';
import { userAccess } from '../access';
import { bankKeys, settings, user } from '../db/schema';
import type { Database } from '../db/types';
import { lastRun, markRun } from '../jobRuns';
import type { FetchLike } from './pluggy';
import { PostgresBanksRepository } from './repository';
import { syncUser, type BankSyncResult } from './service';

/**
 * Open Finance in the background: once an hour, every account with access to the module and a
 * saved key has its brokers read (lib/server/banks/service.ts `syncUser`). Pluggy updates each bank
 * once a day, so most hours only ask "anything new?".
 */

const BANKS_JOB = 'banks';
const EVERY_MS = 60 * 60 * 1000;

export interface BanksJobResult {
  people: number;
  /** Per person, what each bank brought. */
  results: { userId: string; banks: BankSyncResult[] }[];
}

export async function runBanksJob(
  db: Database,
  now: Date = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<BanksJobResult> {
  const previous = await lastRun(db, BANKS_JOB);
  if (previous && now.getTime() - previous.getTime() < EVERY_MS) return { people: 0, results: [] };
  await markRun(db, BANKS_JOB, now);

  const people = await db
    .select({ userId: bankKeys.userId, email: user.email })
    .from(bankKeys)
    .innerJoin(settings, eq(settings.userId, bankKeys.userId))
    .innerJoin(user, eq(user.id, bankKeys.userId))
    .where(sql`coalesce((${settings.modules}->>'banks')::boolean, true)`);

  const results: BanksJobResult['results'] = [];
  for (const { userId, email } of people) {
    try {
      // While restricted: someone whose access was taken back keeps the data, but nothing is read for them.
      if (!mayUseModule(await userAccess(db, userId, email), 'banks')) continue;
      const banks = await syncUser(new PostgresBanksRepository(db, userId), userId, fetchImpl, now);
      if (banks) results.push({ userId, banks });
    } catch (err) {
      console.error('[bancos] falha ao ler os bancos de uma conta:', err instanceof Error ? err.message : err);
    }
  }
  return { people: people.length, results };
}
