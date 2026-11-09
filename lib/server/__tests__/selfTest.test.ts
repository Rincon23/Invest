// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { count, eq, like, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODULE_KEYS } from '@/lib/modules';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { SELF_CHECKS, SELF_TEST_AREAS } from '../selfTest/catalog';
import { CheckFailure, type SelfCheck } from '../selfTest/check';
import { failureNotice, runSelfTests, selfTestOverview } from '../selfTest/runner';

/**
 * The automatic tests of Administração, run here against a fresh database: on a healthy one
 * nothing fails and nothing they write stays; on a broken one the module's test fails, and the
 * owner hears about it once.
 */

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

beforeEach(() => {
  // No outside service answers here: B3, Yahoo, Fundamentus, SMTP and the AI are all "down".
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('sem rede nos testes')));
  for (const name of ['SMTP_HOST', 'VAPID_PUBLIC_KEY', 'WHISPER_URL', 'OLLAMA_URL', 'ENCRYPTION_KEY'])
    vi.stubEnv(name, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function rows(table: PgTable) {
  const [{ total }] = await db.select({ total: count() }).from(table);
  return total;
}

const failing = (message: string): SelfCheck => ({
  id: 'server.fake',
  name: 'Teste que falha',
  run: async () => {
    throw new CheckFailure(message);
  },
});

describe('the catalog', () => {
  it('has tests for the server and for every module', () => {
    expect(SELF_TEST_AREAS).toEqual(['server', ...MODULE_KEYS]);
    for (const area of SELF_TEST_AREAS) expect(SELF_CHECKS[area].length, area).toBeGreaterThan(0);
    const ids = Object.values(SELF_CHECKS)
      .flat()
      .map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('on a healthy server', () => {
  it('passes every test of the Capital itself, and an outside service down is only a warning', async () => {
    const run = await runSelfTests(db, { trigger: 'manual' });
    const failed = run.results.filter((result) => result.status === 'fail');
    expect(failed.map((result) => `${result.id}: ${result.message}`)).toEqual([]);

    const status = Object.fromEntries(run.results.map((result) => [result.id, result.status]));
    for (const check of Object.values(SELF_CHECKS).flat()) {
      if (!check.external) expect(['ok', 'skip'], check.id).toContain(status[check.id]);
    }
    // The network is off: the quotes warn, never fail.
    expect(status['cash.quotes']).toBe('warn');
    expect(status['diagram.quotes']).toBe('warn');
    // The scheduler isn't running in a test.
    expect(status['server.scheduler']).toBe('skip');
  }, 60_000);

  it('leaves nothing behind: not the scratch accounts, not a single row', async () => {
    await runSelfTests(db, { trigger: 'manual' });
    expect(
      await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(like(schema.user.email, '%@autoteste.invalid')),
    ).toEqual([]);
    for (const table of [
      schema.budgetSettings,
      schema.months,
      schema.expenses,
      schema.incomes,
      schema.cards,
      schema.installments,
      schema.recurringExpenses,
      schema.reminders,
      schema.xpEvents,
      schema.notifications,
      schema.bankTransactions,
      schema.diagramContributions,
    ]) {
      expect(await rows(table)).toBe(0);
    }
  }, 60_000);
});

describe('when something breaks', () => {
  it("fails the module's test and says what happened", async () => {
    await db.execute(sql`alter table cards rename to cards_quebrada`);
    try {
      const run = await runSelfTests(db, { trigger: 'manual', checks: { card: SELF_CHECKS.card } });
      expect(run.results).toEqual([
        expect.objectContaining({
          id: 'card.bill',
          area: 'card',
          status: 'fail',
          message: expect.stringContaining('Erro inesperado'),
        }),
      ]);
    } finally {
      await db.execute(sql`alter table cards_quebrada rename to cards`);
    }
  }, 60_000);

  it('warns the owner once when a test starts failing, and keeps the run for Administração', async () => {
    const owner = randomUUID();
    vi.stubEnv('OWNER_EMAIL', 'dono@teste.local');
    await db.insert(schema.user).values({ id: owner, name: 'Dono', email: 'dono@teste.local' });
    const ownerNotices = () =>
      db
        .select({
          title: schema.notifications.title,
          body: schema.notifications.body,
          href: schema.notifications.href,
        })
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, owner));

    await runSelfTests(db, { trigger: 'manual', checks: { server: [] } });
    await runSelfTests(db, { trigger: 'schedule', checks: { server: [failing('O banco sumiu.')] } });
    expect(await ownerNotices()).toEqual([
      {
        title: '🧪 Um teste automático falhou',
        body: 'Servidor: Teste que falha. O banco sumiu.',
        href: '/admin',
      },
    ]);

    // Still failing an hour later: no second notification.
    await runSelfTests(db, { trigger: 'schedule', checks: { server: [failing('O banco sumiu.')] } });
    expect(await ownerNotices()).toHaveLength(1);

    const overview = await selfTestOverview(db);
    expect(overview.last).toMatchObject({
      trigger: 'schedule',
      results: [{ id: 'server.fake', status: 'fail', message: 'O banco sumiu.' }],
    });
    expect(overview.history[0]).toMatchObject({ failed: 1, warned: 0 });
    expect(overview.running).toBe(false);
  }, 60_000);

  it('sums up many failures by module', () => {
    const result = (area: 'card' | 'server' | 'reminders') => ({
      id: `${area}.x`,
      area,
      name: 'x',
      status: 'fail' as const,
      message: 'x',
      durationMs: 1,
    });
    expect(failureNotice([result('card'), result('server'), result('reminders'), result('card')])).toBe(
      '4 testes falharam: Cartão, Servidor e Lembretes. Veja em Administração.',
    );
  });
});
