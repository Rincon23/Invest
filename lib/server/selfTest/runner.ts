import 'server-only';
import { desc, inArray } from 'drizzle-orm';
import { selfTestAreaName } from '../../admin/selfTest';
import type {
  SelfTestArea,
  SelfTestOverview,
  SelfTestResult,
  SelfTestRun,
  SelfTestStatus,
  SelfTestTrigger,
} from '../../admin/types';
import { notifyOwner } from '../alerts';
import { selfTestRuns } from '../db/schema';
import type { Database } from '../db/types';
import { SELF_CHECKS, SELF_TEST_AREAS } from './catalog';
import { CheckFailure, inScratch, type CheckContext, type SelfCheck } from './check';

/**
 * The automatic tests (Administração → Testes automáticos): every module and the server itself,
 * tested inside the running server against the real database — each write in a transaction that
 * is always undone (./check.ts). They run a few minutes after every start, then every hour, and
 * whenever the owner asks. A test that starts failing reaches the owner like the other server
 * warnings (the bell and the phone); one that keeps failing is not repeated.
 */

/** How many runs are kept: a few days of hourly rounds. */
const KEEP_RUNS = 100;
/** Runs listed under the last one in Administração. */
const HISTORY_SHOWN = 12;
const CHECK_TIMEOUT_MS = 30_000;
/** After a start, the minute loop needs its first rounds before "Tarefas em segundo plano" can pass. */
const START_DELAY_MS = 4 * 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;
const MESSAGE_MAX = 400;

const globalForTests = globalThis as unknown as {
  capitalSelfTests?: { started: boolean; running: boolean; nextAt: number | null };
};

function state() {
  globalForTests.capitalSelfTests ??= { started: false, running: false, nextAt: null };
  return globalForTests.capitalSelfTests;
}

export class SelfTestsBusyError extends Error {
  constructor() {
    super('Os testes já estão rodando.');
    this.name = 'SelfTestsBusyError';
  }
}

/** An outside service that did not answer is said as such; anything else is a bug worth reading. */
function errorMessage(err: unknown, external: boolean): string {
  if (err instanceof CheckFailure) return err.message;
  const text = err instanceof Error ? err.message : String(err);
  return (external ? `Não respondeu (${text}).` : `Erro inesperado: ${text}`).slice(0, MESSAGE_MAX);
}

async function runCheck(check: SelfCheck, area: SelfTestArea, ctx: CheckContext): Promise<SelfTestResult> {
  const started = performance.now();
  let status: SelfTestStatus = 'ok';
  let message: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new CheckFailure(`Não terminou em ${CHECK_TIMEOUT_MS / 1000} segundos.`)),
        CHECK_TIMEOUT_MS,
      );
    });
    const outcome = await Promise.race([check.run(ctx), timeout]);
    if (outcome) ({ status, message } = outcome);
  } catch (err) {
    status = check.external ? 'warn' : 'fail';
    message = errorMessage(err, check.external === true);
    if (!(err instanceof CheckFailure) && !check.external) console.error(`[autoteste] ${check.id}:`, err);
  } finally {
    clearTimeout(timer);
  }
  return {
    id: check.id,
    area,
    name: check.name,
    status,
    message,
    durationMs: Math.round(performance.now() - started),
  };
}

/** What the owner's notification says about the tests that just started failing. */
export function failureNotice(failed: SelfTestResult[]): string {
  if (failed.length === 1) {
    const [only] = failed;
    return `${selfTestAreaName(only.area)}: ${only.name}. ${only.message ?? ''}`.trim();
  }
  const areas = [...new Set(failed.map((result) => selfTestAreaName(result.area)))];
  const names = areas.length === 1 ? areas[0] : `${areas.slice(0, -1).join(', ')} e ${areas.at(-1)}`;
  return `${failed.length} testes falharam: ${names}. Veja em Administração.`;
}

/**
 * Runs every test, keeps the run and warns the owner about the tests that failed now and did not
 * fail in the run before. Throws SelfTestsBusyError while another run is going on.
 */
export async function runSelfTests(
  db: Database,
  {
    trigger,
    checks = SELF_CHECKS,
    now = new Date(),
  }: { trigger: SelfTestTrigger; checks?: Partial<Record<SelfTestArea, SelfCheck[]>>; now?: Date },
): Promise<SelfTestRun> {
  const current = state();
  if (current.running) throw new SelfTestsBusyError();
  current.running = true;
  try {
    const ctx: CheckContext = { db, now, scratch: (fn) => inScratch(db, now, fn) };
    const results: SelfTestResult[] = [];
    for (const area of SELF_TEST_AREAS) {
      for (const check of checks[area] ?? []) results.push(await runCheck(check, area, ctx));
    }
    const finishedAt = new Date();

    const [previous] = await db
      .select({ results: selfTestRuns.results })
      .from(selfTestRuns)
      .orderBy(desc(selfTestRuns.startedAt))
      .limit(1);
    const [row] = await db
      .insert(selfTestRuns)
      .values({
        trigger,
        startedAt: now,
        finishedAt,
        results,
        failed: results.filter((result) => result.status === 'fail').length,
        warned: results.filter((result) => result.status === 'warn').length,
      })
      .returning({ id: selfTestRuns.id });
    const old = await db
      .select({ id: selfTestRuns.id })
      .from(selfTestRuns)
      .orderBy(desc(selfTestRuns.startedAt))
      .offset(KEEP_RUNS);
    if (old.length > 0)
      await db.delete(selfTestRuns).where(
        inArray(
          selfTestRuns.id,
          old.map((item) => item.id),
        ),
      );

    const failedBefore = new Set(
      (previous?.results ?? []).filter((result) => result.status === 'fail').map((result) => result.id),
    );
    const newlyFailed = results.filter((result) => result.status === 'fail' && !failedBefore.has(result.id));
    if (newlyFailed.length > 0) {
      await notifyOwner(db, 'self-test', failureNotice(newlyFailed)).catch((err: unknown) =>
        console.error('[autoteste] falha ao avisar o dono:', err instanceof Error ? err.message : err),
      );
    }

    return {
      id: row.id,
      trigger,
      startedAt: now.toISOString(),
      finishedAt: finishedAt.toISOString(),
      results,
    };
  } finally {
    current.running = false;
  }
}

/** The last run with all its results, and the ones before it in short. */
export async function selfTestOverview(db: Database): Promise<SelfTestOverview> {
  const [[last], history] = await Promise.all([
    db.select().from(selfTestRuns).orderBy(desc(selfTestRuns.startedAt)).limit(1),
    db
      .select({
        id: selfTestRuns.id,
        startedAt: selfTestRuns.startedAt,
        failed: selfTestRuns.failed,
        warned: selfTestRuns.warned,
      })
      .from(selfTestRuns)
      .orderBy(desc(selfTestRuns.startedAt))
      .offset(1)
      .limit(HISTORY_SHOWN),
  ]);
  const { running, nextAt } = state();
  return {
    last: last
      ? {
          id: last.id,
          trigger: last.trigger,
          startedAt: last.startedAt.toISOString(),
          finishedAt: last.finishedAt.toISOString(),
          // A run from before a module was retired (the Monitor de Gmail) still has its results.
          results: last.results.filter((result) => SELF_TEST_AREAS.includes(result.area)),
        }
      : null,
    running,
    nextAt: nextAt === null ? null : new Date(nextAt).toISOString(),
    history: history.map((item) => ({ ...item, startedAt: item.startedAt.toISOString() })),
  };
}

/**
 * Starts the rounds once per server process: the first a few minutes after the start, then every
 * hour. Like the other background jobs, SCHEDULER=off turns them off.
 */
export function startSelfTests(getDb: () => Database): void {
  const current = state();
  if (current.started || process.env.SCHEDULER === 'off') return;
  current.started = true;

  const scheduleNext = (delay: number, trigger: SelfTestTrigger) => {
    current.nextAt = Date.now() + delay;
    setTimeout(() => {
      void runSelfTests(getDb(), { trigger })
        .catch((err: unknown) => {
          if (!(err instanceof SelfTestsBusyError)) console.error('[autoteste] falha na rodada:', err);
        })
        .finally(() => scheduleNext(EVERY_MS, 'schedule'));
    }, delay).unref?.();
  };
  scheduleNext(START_DELAY_MS, 'start');
  console.log('[autoteste] testes automáticos a cada hora ativados.');
}
