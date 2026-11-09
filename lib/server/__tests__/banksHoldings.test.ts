// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkHoldings } from '@/lib/banks';
import type { FetchLike } from '../banks/pluggy';
import { PostgresBanksRepository } from '../banks/repository';
import { forgetPluggyKey, syncUser } from '../banks/service';
import * as schema from '../db/schema';
import type { Database } from '../db/types';

/**
 * The quantities the broker sends (Pluggy's `code`, `quantity` and `isin`, as the BTG sent them in
 * the F0) are kept with each investment and compared with the Diagrama.
 */

type Answer = { status?: number; body: unknown };

function fakePluggy(routes: Record<string, Answer | ((path: string) => Answer)>): FetchLike {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input).replace('https://api.pluggy.ai', '');
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    const answer = typeof route === 'function' ? route(path) : route;
    if (!answer) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as FetchLike;
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

const ITEM = '6f1c2c3e-0000-4000-8000-0000000000b7';
const FIRST = '2026-10-20T12:57:28.616Z';
const SECOND = '2026-10-21T13:10:00.000Z';

const account = {
  id: 'acc-1',
  type: 'BANK',
  subtype: 'CHECKING_ACCOUNT',
  name: 'BTG Banking',
  balance: 100,
  currencyCode: 'BRL',
  bankData: { transferNumber: '208/0001/1234567-8' },
};

const stock = (id: string, code: string, quantity: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  name: code,
  code,
  isin: `BR${code}ACNOR0`,
  quantity,
  type: 'EQUITY',
  subtype: 'STOCK',
  balance: (quantity ?? 0) * 10,
  ...extra,
});

describe('the quantities from the broker', () => {
  it('are kept with each investment, follow every read and are compared with the Diagrama', async () => {
    const id = randomUUID();
    await db.insert(schema.user).values({ id, name: 'Pessoa', email: `${id}@teste.local` });
    forgetPluggyKey(id);
    const banks = new PostgresBanksRepository(db, id);
    await banks.saveKey('id', 'segredo');
    await banks.addPending(ITEM, null);
    await banks.updateConnection(ITEM, { status: 'ok', lastUpdatedAt: new Date(FIRST) });

    let lastUpdatedAt = FIRST;
    let investments: unknown[] = [
      stock('inv-petr', 'PETR4', 120),
      stock('inv-wege', 'WEGE3', 40),
      stock('inv-hglg', 'HGLG11', 7, { subtype: 'REAL_ESTATE_FUND' }),
      {
        id: 'inv-cdb',
        name: 'CDB BTG',
        code: 'CDB0123ABC',
        quantity: 1,
        type: 'FIXED_INCOME',
        subtype: 'CDB',
        balance: 500,
      },
    ];
    const fetchImpl = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      [`GET /items/${ITEM}`]: () => ({ body: { id: ITEM, status: 'UPDATED', lastUpdatedAt } }),
      'GET /accounts': { body: { results: [account] } },
      'GET /investments': () => ({ body: { results: investments } }),
      'GET /v2/transactions': { body: { results: [], next: null } },
    });
    await syncUser(banks, id, fetchImpl, new Date('2026-10-20T15:00:00Z'));

    const read = await banks.holdings();
    expect(read.banks).toEqual([{ itemId: ITEM, name: 'BTG Pactual', status: 'ok', lastUpdatedAt: FIRST }]);
    expect(read.holdings.find((holding) => holding.investmentId === 'inv-petr')).toEqual({
      investmentId: 'inv-petr',
      itemId: ITEM,
      bankName: 'BTG Pactual',
      name: 'PETR4',
      type: 'EQUITY',
      subtype: 'STOCK',
      code: 'PETR4',
      isin: 'BRPETR4ACNOR0',
      quantity: 120,
      feedsReserve: false,
    });

    const diagram = [
      { id: 'a-petr', ticker: 'PETR4', quantity: 100 },
      { id: 'a-wege', ticker: 'WEGE3', quantity: 40 },
      { id: 'a-itsa', ticker: 'ITSA4', quantity: 10 },
    ];
    const check = checkHoldings({ ...read, reserve: await banks.investedReserve() }, diagram);
    expect(check.assets['a-petr']).toMatchObject({ status: 'different', bank: 120, capital: 100, use: 120 });
    expect(check.assets['a-wege'].status).toBe('match');
    expect(check.assets['a-itsa']).toMatchObject({ status: 'onlyCapital', use: 0 });
    expect(check.onlyBank.map((item) => [item.ticker, item.quantity, item.type])).toEqual([
      ['HGLG11', 7, 'fiis'],
    ]);

    // The next day the person sold all the WEGE3 and bought more PETR4: the read follows.
    lastUpdatedAt = SECOND;
    investments = [
      stock('inv-petr', 'PETR4', 150),
      stock('inv-hglg', 'HGLG11', 7, { subtype: 'REAL_ESTATE_FUND' }),
    ];
    await syncUser(banks, id, fetchImpl, new Date('2026-10-21T15:00:00Z'));
    const after = await banks.holdings();
    expect(after.holdings.map((holding) => [holding.code, holding.quantity])).toEqual([
      ['HGLG11', 7],
      ['PETR4', 150],
    ]);
    expect(after.banks[0].lastUpdatedAt).toBe(SECOND);
    const again = checkHoldings({ ...after, reserve: null }, diagram);
    expect(again.assets['a-petr']).toMatchObject({ bank: 150, use: 150 });
    expect(again.assets['a-wege']).toMatchObject({ status: 'onlyCapital', use: 0 });
  });

  it('brings the Reserva investida only when it holds quotas', async () => {
    const id = randomUUID();
    await db.insert(schema.user).values({ id, name: 'Pessoa', email: `${id}@teste.local` });
    const banks = new PostgresBanksRepository(db, id);
    expect(await banks.investedReserve()).toBeNull();
    await db.insert(schema.investmentReserves).values({ userId: id, ticker: 'AUPO11', totalQuotas: 0 });
    expect(await banks.investedReserve()).toBeNull();
    await db.update(schema.investmentReserves).set({ totalQuotas: 20 });
    expect(await banks.investedReserve()).toEqual({ ticker: 'AUPO11', quotas: 20 });
    expect(await banks.holdings()).toEqual({ banks: [], holdings: [] });
  });
});
