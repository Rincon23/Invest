// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBanksJob } from '../banks/job';
import type { FetchLike } from '../banks/pluggy';
import { PostgresBanksRepository } from '../banks/repository';
import { forgetPluggyKey, syncUser } from '../banks/service';
import * as schema from '../db/schema';
import type { Database } from '../db/types';

/** The brokers' daily read: only the investments, and only when the bank sent something new. */

type Answer = { status?: number; body: unknown };

function fakePluggy(routes: Record<string, Answer | ((path: string) => Answer)>) {
  const calls: { method: string; path: string }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input).replace('https://api.pluggy.ai', '');
    calls.push({ method, path });
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    const answer = typeof route === 'function' ? route(path) : route;
    if (!answer) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as FetchLike;
  return { fetchImpl, calls };
}

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function newPerson() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Pessoa', email: `${id}@teste.local` });
  forgetPluggyKey(id);
  return { id, banks: new PostgresBanksRepository(db, id) };
}

const ITEM = '6f1c2c3e-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-20T15:00:00Z');
const FIRST = '2026-10-20T12:57:28.616Z';
const SECOND = '2026-10-21T13:10:00.000Z';

const accounts = {
  results: [
    {
      id: 'acc-1',
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      name: 'BTG Banking',
      balance: 10,
      bankData: { transferNumber: '208/0001/1234567-8' },
    },
  ],
};
const stock = (id: string, code: string, quantity: number) => ({
  id,
  name: code,
  type: 'EQUITY',
  subtype: 'STOCK',
  code,
  quantity,
  balance: quantity * 10,
});

/** A broker that already arrived, and a Pluggy that has `item()` and `investments()`. */
async function arrivedBank(item: () => Record<string, unknown>, investments: () => unknown[]) {
  const { id, banks } = await newPerson();
  await banks.saveKey('id', 'segredo');
  await banks.addPending(ITEM, null);
  await banks.updateConnection(ITEM, { status: 'ok' });
  const fake = fakePluggy({
    'POST /auth': { body: { apiKey: 'chave' } },
    [`GET /items/${ITEM}`]: () => ({ body: { id: ITEM, ...item() } }),
    'GET /accounts': { body: accounts },
    'GET /investments': () => ({ body: { results: investments() } }),
  });
  return { id, banks, ...fake };
}

describe('the sync', () => {
  it('reads the investments and names the bank, never the transactions', async () => {
    const { id, banks, fetchImpl, calls } = await arrivedBank(
      () => ({ status: 'UPDATED', lastUpdatedAt: FIRST }),
      () => [stock('petr', 'PETR4', 120)],
    );
    const results = await syncUser(banks, id, fetchImpl, NOW);
    expect(results).toEqual([{ itemId: ITEM, changed: true }]);
    const [connection] = await banks.listConnections();
    expect(connection).toMatchObject({ name: 'BTG Pactual', status: 'ok', investments: 1 });
    expect((await banks.holdings()).holdings.map((holding) => [holding.code, holding.quantity])).toEqual([
      ['PETR4', 120],
    ]);
    expect(calls.some((call) => call.path.startsWith('/v2/transactions'))).toBe(false);
  });

  it('only asks "anything new?" while the bank sent nothing, and reads again when it did', async () => {
    let lastUpdatedAt = FIRST;
    let investments = [stock('petr', 'PETR4', 120)];
    const { id, banks, fetchImpl, calls } = await arrivedBank(
      () => ({ status: 'UPDATED', lastUpdatedAt }),
      () => investments,
    );
    await syncUser(banks, id, fetchImpl, NOW);
    const read = () => calls.filter((call) => call.path.startsWith('/investments')).length;
    expect(read()).toBe(1);

    expect(await syncUser(banks, id, fetchImpl, NOW)).toEqual([{ itemId: ITEM, changed: false }]);
    expect(read()).toBe(1);

    lastUpdatedAt = SECOND;
    investments = [stock('petr', 'PETR4', 150)];
    await syncUser(banks, id, fetchImpl, NOW);
    expect(read()).toBe(2);
    expect((await banks.holdings()).holdings[0].quantity).toBe(150);
  });

  it('keeps the status while Pluggy updates, and asks to bring again a bank gone at Pluggy', async () => {
    const { id, banks, fetchImpl } = await arrivedBank(
      () => ({ status: 'UPDATING', lastUpdatedAt: FIRST }),
      () => [],
    );
    await syncUser(banks, id, fetchImpl, NOW);
    expect((await banks.listConnections())[0].status).toBe('ok');

    const missing = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      [`GET /items/${ITEM}`]: { status: 404, body: { message: 'Item not found' } },
    });
    await syncUser(banks, id, missing.fetchImpl, NOW);
    expect((await banks.listConnections())[0].status).toBe('reconnect');
  });

  it('a read that comes back without investments keeps the ones it had', async () => {
    let lastUpdatedAt = FIRST;
    let investments: unknown[] = [stock('petr', 'PETR4', 120)];
    const { id, banks, fetchImpl } = await arrivedBank(
      () => ({ status: 'UPDATED', lastUpdatedAt }),
      () => investments,
    );
    await syncUser(banks, id, fetchImpl, NOW);
    lastUpdatedAt = SECOND;
    investments = [];
    await syncUser(banks, id, fetchImpl, NOW);
    expect((await banks.holdings()).holdings).toHaveLength(1);
  });

  it('never runs twice at the same time for the same person', async () => {
    const { id, banks, fetchImpl } = await arrivedBank(
      () => ({ status: 'UPDATED', lastUpdatedAt: FIRST }),
      () => [],
    );
    const results = await Promise.all([syncUser(banks, id, fetchImpl, NOW), syncUser(banks, id, fetchImpl, NOW)]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
  });
});

describe('the hourly job', () => {
  it('reads only accounts with access, once an hour, and one failure stops nobody', async () => {
    const vip = await newPerson();
    const notVip = await newPerson();
    const broken = await newPerson();
    for (const person of [broken, vip, notVip]) {
      await db.insert(schema.settings).values({ userId: person.id, modules: { banks: true } });
      await person.banks.saveKey(person === broken ? 'quebrada' : 'id', 'segredo');
      await person.banks.addPending(`${person.id}-item`, null);
      await person.banks.updateConnection(`${person.id}-item`, { status: 'ok' });
    }
    await db.insert(schema.vipUsers).values([{ userId: vip.id }, { userId: broken.id }]);

    const asked: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input).replace('https://api.pluggy.ai', '');
      if (path === '/auth') {
        const { clientId } = JSON.parse(String(init?.body)) as { clientId: string };
        if (clientId === 'quebrada') return new Response('{"message":"boom"}', { status: 500 });
        return new Response('{"apiKey":"chave"}');
      }
      asked.push(path);
      return new Response(JSON.stringify({ id: 'x', status: 'UPDATING' }));
    }) as unknown as FetchLike;

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = await runBanksJob(db, NOW, fetchImpl);
    errors.mockRestore();
    expect(run.results.map((result) => result.userId)).toEqual([vip.id]);
    expect(asked).toEqual([`/items/${vip.id}-item`]);

    // Within the hour, nothing runs again.
    expect((await runBanksJob(db, new Date(NOW.getTime() + 30 * 60_000), fetchImpl)).results).toEqual([]);
  });
});
