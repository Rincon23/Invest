import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { todayISO } from '../../core/date';
import { effectiveModules } from '../../modules';
import { PostgresBanksRepository } from '../banks/repository';
import { settings, user } from '../db/schema';
import type { Database } from '../db/types';
import { PostgresDiagramRepository } from '../diagramRepository';
import { PostgresSettingsRepository } from '../settingsRepository';

/**
 * What one automatic test is (lib/server/selfTest). A test passes by returning nothing and fails
 * by throwing — `expect` and `expectEqual` below say what was wrong, in words the owner reads in
 * Administração. It may also return a warning or say there is nothing to test on this server.
 */
export interface SelfCheck {
  /** Stable across runs ("card.bill"). */
  id: string;
  name: string;
  /**
   * Depends on a free service outside the app (B3, Yahoo, Fundamentus): when it fails, it is a
   * warning — the fix is not in the code.
   */
  external?: boolean;
  run(ctx: CheckContext): Promise<CheckOutcome | void>;
}

export type CheckOutcome = { status: 'warn' | 'skip'; message: string };

export interface CheckContext {
  /** The real database. Only read from it: anything written goes through `scratch`. */
  db: Database;
  now: Date;
  /**
   * Runs `fn` as a brand-new account with every module on, inside a transaction that is always
   * undone: the test writes for real, through the same repositories the screens use, and nothing
   * of it stays — not the account, not a single row.
   */
  scratch<T>(fn: (account: ScratchAccount) => Promise<T>): Promise<T>;
}

export interface ScratchAccount {
  /** The open transaction, for the reads a repository doesn't offer. */
  db: Database;
  userId: string;
  settings: PostgresSettingsRepository;
  diagram: PostgresDiagramRepository;
  banks: PostgresBanksRepository;
  /** Today, as the repositories themselves read it. */
  today: string;
}

/** A test that did not pass; the message is what Administração shows. */
export class CheckFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckFailure';
  }
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}

/** Money and counts: equal to the cent, or the message says what came instead. */
export function expectEqual(actual: unknown, expected: unknown, what: string): void {
  const same =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) < 0.005
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) throw new CheckFailure(`${what}: esperava ${show(expected)}, veio ${show(actual)}.`);
}

function show(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return value === undefined ? 'nada' : JSON.stringify(value);
}

/** Thrown at the end of every scratch transaction, so the database undoes all of it. */
class Undo extends Error {}

/** How long one statement of a test may take: a stuck query can't hold its transaction open. */
const STATEMENT_TIMEOUT = '15s';

export async function inScratch<T>(
  db: Database,
  now: Date,
  fn: (account: ScratchAccount) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  try {
    await db.transaction(async (tx) => {
      const scope = tx as unknown as Database;
      await scope.execute(sql.raw(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`));
      result = await fn(await scratchAccount(scope, now));
      throw new Undo();
    });
  } catch (err) {
    if (!(err instanceof Undo)) throw err;
  }
  return result as T;
}

async function scratchAccount(db: Database, now: Date): Promise<ScratchAccount> {
  const userId = randomUUID();
  // `.invalid` is a domain that never exists: no e-mail could ever reach it.
  await db
    .insert(user)
    .values({ id: userId, name: 'Autoteste', email: `autoteste-${userId}@autoteste.invalid` });
  const accountSettings = new PostgresSettingsRepository(db, userId);
  await accountSettings.getSettings();
  await db
    .update(settings)
    .set({ modules: effectiveModules({ vip: true, vipModules: [] }), onboardingCompleted: true })
    .where(eq(settings.userId, userId));
  return {
    db,
    userId,
    settings: accountSettings,
    diagram: new PostgresDiagramRepository(db, userId),
    banks: new PostgresBanksRepository(db, userId),
    today: todayISO(now),
  };
}

/** Throws unless `promise` rejects (what a refused write looks like to the screen). */
export async function expectRefused(promise: Promise<unknown>, message: string): Promise<void> {
  const refused = await promise.then(
    () => false,
    () => true,
  );
  expect(refused, message);
}

/** An outside request that gives up after `ms`. */
export async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
