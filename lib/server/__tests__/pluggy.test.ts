// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccountData } from '../accountData';
import {
  authorizeUrlOf,
  nextPagePath,
  PluggyClient,
  pluggyApiKey,
  PluggyError,
  type FetchLike,
} from '../banks/pluggy';
import { PostgresBanksRepository } from '../banks/repository';
import {
  banksRedirectUri,
  checkAndSaveKey,
  disconnectAll,
  forgetPluggyKey,
  refreshPending,
  removeConnection,
  startConnection,
  syncUser,
} from '../banks/service';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { HttpError } from '../httpError';

type Answer = { status?: number; body: unknown };

/** A fake Pluggy: answers by method and path (query included), and records what it was asked. */
function fakePluggy(routes: Record<string, Answer | ((path: string) => Answer)>) {
  const calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.pluggy.ai', '');
    calls.push({
      method,
      path,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    const answer = typeof route === 'function' ? route(path) : route;
    if (!answer) return new Response(JSON.stringify({ message: 'not found', code: 404 }), { status: 404 });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as FetchLike;
  return { fetchImpl, calls };
}

describe('pluggyApiKey', () => {
  it('trades the Client ID and Secret for the apiKey', async () => {
    const { fetchImpl, calls } = fakePluggy({ 'POST /auth': { body: { apiKey: 'chave' } } });
    await expect(pluggyApiKey('id', 'segredo', fetchImpl)).resolves.toBe('chave');
    expect(calls[0].body).toEqual({ clientId: 'id', clientSecret: 'segredo' });
  });

  it("turns a refusal into Pluggy's own message and code", async () => {
    const { fetchImpl } = fakePluggy({
      'POST /auth': {
        status: 401,
        body: { code: 401, message: 'Invalid credentials', codeDescription: 'INVALID_CREDENTIALS' },
      },
    });
    const error = await pluggyApiKey('id', 'errado', fetchImpl).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PluggyError);
    expect(error).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
  });
});

describe('PluggyClient.allTransactions', () => {
  it('follows next until it comes back empty, sending the apiKey', async () => {
    const { fetchImpl, calls } = fakePluggy({
      'GET /v2/transactions?accountId=a1&dateFrom=2026-10-01&dateTo=2026-10-20': {
        body: {
          results: [{ id: 't1' }],
          next: 'https://api.pluggy.ai/v2/transactions?accountId=a1&dateFrom=2026-10-01&dateTo=2026-10-20&after=c1',
        },
      },
      'GET /v2/transactions?after=c2&accountId=a1&dateFrom=2026-10-01&dateTo=2026-10-20': {
        body: { results: [{ id: 't3' }], next: null },
      },
      'GET /v2/transactions?accountId=a1&dateFrom=2026-10-01&dateTo=2026-10-20&after=c1': {
        // A bare query string, without the account and the days: they go back in.
        body: { results: [{ id: 't2' }], next: 'after=c2' },
      },
    });
    const client = new PluggyClient('chave', fetchImpl);
    const all = await client.allTransactions('a1', '2026-10-01', '2026-10-20');
    expect(all).toEqual([{ id: 't1' }, { id: 't2' }, { id: 't3' }]);
    expect(calls.every((call) => call.headers['X-API-KEY'] === 'chave')).toBe(true);
  });

  it('never follows a next that points outside Pluggy', () => {
    const first = new URLSearchParams({ accountId: 'a1' });
    expect(nextPagePath('https://evil.example/v2/transactions?after=x', first)).toBeNull();
    expect(nextPagePath('/v2/transactions?after=x', first)).toBe('/v2/transactions?after=x&accountId=a1');
  });
});

describe('authorizeUrlOf', () => {
  it('finds the address Meu Pluggy puts in parameter.data, and only an https one', () => {
    expect(
      authorizeUrlOf({ id: 'i', status: 'WAITING_USER_INPUT', parameter: { type: 'oauth', data: 'https://meu.pluggy.ai/x' } }),
    ).toBe('https://meu.pluggy.ai/x');
    expect(authorizeUrlOf({ id: 'i', status: 'UPDATING', parameter: { data: 'iVBORw0KGgo=' } })).toBeNull();
    expect(
      authorizeUrlOf({ id: 'i', status: 'UPDATING', userAction: { attributes: { link: 'https://meu.pluggy.ai/a' } } }),
    ).toBe('https://meu.pluggy.ai/a');
  });
});

// ---------------------------------------------------------------------------
// The Open Finance flows, against the database
// ---------------------------------------------------------------------------

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('BETTER_AUTH_URL', 'https://capital.exemplo.com.br');
  vi.stubEnv('PLUGGY_REDIRECT_URI', '');
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

const accounts = {
  results: [
    {
      id: 'acc-1',
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      name: 'BTG Banking',
      balance: 1234.56,
      currencyCode: 'BRL',
      bankData: { transferNumber: '208/0001/1234567-8' },
    },
    { id: 'acc-2', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'gold', balance: 300, currencyCode: 'BRL' },
  ],
};

describe('the key', () => {
  it('is saved only after Pluggy accepts it, encrypted, and only its end ever comes back', async () => {
    const { id, banks } = await newPerson();
    const { fetchImpl } = fakePluggy({ 'POST /auth': { body: { apiKey: 'chave' } } });
    await checkAndSaveKey(banks, id, { clientId: 'meu-client-id', clientSecret: 'segredo-1234' }, fetchImpl);

    expect(await banks.getKey()).toEqual({ clientId: 'meu-client-id', secretHint: '1234' });
    const [row] = await db.select().from(schema.bankKeys).where(eq(schema.bankKeys.userId, id));
    expect(row.clientSecret).not.toContain('segredo');
    expect((await banks.getCredentials())?.clientSecret).toBe('segredo-1234');
  });

  it('refused by Pluggy, says so in one sentence and saves nothing', async () => {
    const { id, banks } = await newPerson();
    const { fetchImpl } = fakePluggy({ 'POST /auth': { status: 401, body: { message: 'Invalid credentials' } } });
    const error = await checkAndSaveKey(banks, id, { clientId: 'x', clientSecret: 'y' }, fetchImpl).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 400, code: 'INVALID_KEY' });
    expect(await banks.getKey()).toBeNull();
  });
});

describe('bringing a bank', () => {
  it('creates the Meu Pluggy item, waits for the link and keeps the bank as on its way', async () => {
    const { id, banks } = await newPerson();
    let reads = 0;
    const { fetchImpl, calls } = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      'POST /items': { body: { id: ITEM, status: 'UPDATING', executionStatus: 'CREATED', parameter: null } },
      [`GET /items/${ITEM}`]: () => {
        reads += 1;
        return {
          body: {
            id: ITEM,
            status: 'WAITING_USER_INPUT',
            parameter:
              reads > 1
                ? { type: 'oauth', data: 'https://meu.pluggy.ai/autorizar', expiresAt: '2026-10-20T13:38:45.085Z' }
                : null,
          },
        };
      },
    });
    await banks.saveKey('id', 'segredo');

    const { authorizeUrl } = await startConnection(banks, id, fetchImpl, { pollMs: 1, pollTimes: 5 });
    expect(authorizeUrl).toBe('https://meu.pluggy.ai/autorizar');
    expect(calls.find((call) => call.method === 'POST' && call.path === '/items')?.body).toEqual({
      connectorId: 200,
      parameters: {},
      oauthRedirectUri: 'https://capital.exemplo.com.br/bancos',
      clientUserId: id,
    });
    const [connection] = await banks.listConnections();
    expect(connection).toMatchObject({ itemId: ITEM, status: 'pending', accounts: [] });
    const [pending] = await banks.pendingConnections();
    expect(pending.authorizeExpiresAt?.toISOString()).toBe('2026-10-20T13:38:45.085Z');
  });

  it('refuses without an https address to come back to, and at the free limit', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    const { fetchImpl } = fakePluggy({ 'POST /auth': { body: { apiKey: 'chave' } } });

    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
    expect(banksRedirectUri()).toBeNull();
    await expect(startConnection(banks, id, fetchImpl)).rejects.toMatchObject({ code: 'NEEDS_HTTPS' });
    vi.stubEnv('PLUGGY_REDIRECT_URI', 'https://capital.exemplo.com.br/bancos');
    expect(banksRedirectUri()).toBe('https://capital.exemplo.com.br/bancos');

    for (let i = 0; i < 5; i++) await banks.addPending(`item-${i}`, null);
    await expect(startConnection(banks, id, fetchImpl)).rejects.toMatchObject({ code: 'LIMIT' });
  });

  it('without a key, asks for it', async () => {
    const { id, banks } = await newPerson();
    const { fetchImpl } = fakePluggy({});
    await expect(startConnection(banks, id, fetchImpl)).rejects.toMatchObject({ code: 'NO_KEY' });
  });
});

describe('a bank arriving', () => {
  it('brings its investments right away, with their quantities', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    await banks.addPending(ITEM, new Date('2026-10-20T13:38:45Z'));
    const { fetchImpl } = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      [`GET /items/${ITEM}`]: { body: { id: ITEM, status: 'UPDATED', lastUpdatedAt: '2026-10-20T12:57:28.616Z' } },
      'GET /accounts': { body: accounts },
      'GET /investments': {
        body: { results: [{ id: 'inv-1', name: 'PETR4', code: 'PETR4', quantity: 120, type: 'EQUITY', subtype: 'STOCK' }] },
      },
    });
    await refreshPending(banks, id, fetchImpl, new Date('2026-10-20T13:40:00Z'));
    const { holdings } = await banks.holdings();
    expect(holdings.map((holding) => [holding.code, holding.quantity])).toEqual([['PETR4', 120]]);
  });

  it('brings its accounts and a suggested name when Pluggy finishes', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    await banks.addPending(ITEM, new Date('2026-10-20T13:38:45Z'));
    const { fetchImpl } = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      [`GET /items/${ITEM}`]: {
        body: {
          id: ITEM,
          status: 'UPDATED',
          executionStatus: 'SUCCESS',
          lastUpdatedAt: '2026-10-20T12:57:28.616Z',
          nextAutoSyncAt: '2026-10-21T14:21:00.000Z',
          consentExpiresAt: '2027-10-20T13:19:34.167Z',
        },
      },
      'GET /accounts': { body: accounts },
    });

    const { givenUp } = await refreshPending(banks, id, fetchImpl, new Date('2026-10-20T13:40:00Z'));
    expect(givenUp).toBe(0);
    const [connection] = await banks.listConnections();
    expect(connection).toMatchObject({
      name: 'BTG Pactual',
      named: false,
      status: 'ok',
      lastUpdatedAt: '2026-10-20T12:57:28.616Z',
      consentExpiresAt: '2027-10-20T13:19:34.167Z',
      accounts: [
        { id: 'acc-1', kind: 'checking', name: 'BTG Banking' },
        { id: 'acc-2', kind: 'card', name: 'Cartão Gold' },
      ],
    });

    // The person's own name stays, whatever is suggested later.
    await banks.rename(ITEM, 'Meu BTG');
    await banks.updateConnection(ITEM, { status: 'ok', suggestedName: 'Outro' });
    expect((await banks.listConnections())[0]).toMatchObject({ name: 'Meu BTG', named: true });
  });

  it('gives up on an authorization never finished, here and at Pluggy, and marks a lost one', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    await banks.addPending('abandonado', new Date('2026-10-20T13:00:00Z'));
    await banks.addPending('caiu', null);
    const { fetchImpl, calls } = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      'GET /items/abandonado': { body: { id: 'abandonado', status: 'WAITING_USER_INPUT' } },
      'GET /items/caiu': { body: { id: 'caiu', status: 'LOGIN_ERROR' } },
      'DELETE /items/abandonado': { body: {} },
    });

    const { givenUp } = await refreshPending(banks, id, fetchImpl, new Date('2026-10-20T13:10:00Z'));
    expect(givenUp).toBe(1);
    expect(calls.some((call) => call.method === 'DELETE' && call.path === '/items/abandonado')).toBe(true);
    const connections = await banks.listConnections();
    expect(connections.map((c) => [c.itemId, c.status])).toEqual([['caiu', 'reconnect']]);
  });

  it('reads a failed bank again on the next sync, in case Pluggy recovered', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    await banks.addPending(ITEM, null);
    let status = 'OUTDATED';
    const { fetchImpl } = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      [`GET /items/${ITEM}`]: () => ({
        body: {
          id: ITEM,
          status,
          lastUpdatedAt: '2026-10-20T12:57:28.616Z',
          error: status === 'OUTDATED' ? { code: 'UNEXPECTED_ERROR', message: 'Unexpected error.' } : null,
        },
      }),
      'GET /accounts': { body: accounts },
      'GET /v2/transactions': { body: { results: [], next: null } },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await refreshPending(banks, id, fetchImpl);
    expect((await banks.listConnections())[0]).toMatchObject({ name: 'Banco', status: 'error', accounts: [] });
    expect(log.mock.calls.flat().join(' ')).toContain('UNEXPECTED_ERROR');

    status = 'UPDATED';
    await syncUser(banks, id, fetchImpl, new Date('2026-10-20T15:00:00Z'));
    expect((await banks.listConnections())[0]).toMatchObject({ name: 'BTG Pactual', status: 'ok' });
    log.mockRestore();
  });

  it('keeps waiting while the link still works', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    await banks.addPending(ITEM, new Date('2026-10-20T13:38:45Z'));
    const { fetchImpl } = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      [`GET /items/${ITEM}`]: { body: { id: ITEM, status: 'WAITING_USER_INPUT' } },
    });
    await refreshPending(banks, id, fetchImpl, new Date('2026-10-20T13:37:00Z'));
    expect((await banks.listConnections())[0].status).toBe('pending');
  });
});

describe('leaving', () => {
  it('takes one bank out, here and at Pluggy', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    await banks.addPending('a', null);
    await banks.addPending('b', null);
    const { fetchImpl, calls } = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      'DELETE /items/a': { body: {} },
    });
    await removeConnection(banks, id, 'a', fetchImpl);
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['/items/a']);
    expect((await banks.listConnections()).map((c) => c.itemId)).toEqual(['b']);
  });

  it('"Desconectar" removes every bank at Pluggy and the key and banks from the Capital', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    await banks.addPending('a', null);
    await banks.replaceAccounts('a', [{ accountId: 'x', kind: 'checking', name: 'Conta', balance: 1, currency: 'BRL' }]);
    const { fetchImpl, calls } = fakePluggy({
      'POST /auth': { body: { apiKey: 'chave' } },
      'DELETE /items/a': { body: {} },
    });
    await disconnectAll(banks, id, fetchImpl);
    expect(calls.some((call) => call.method === 'DELETE' && call.path === '/items/a')).toBe(true);
    expect(await banks.getKey()).toBeNull();
    expect(await banks.listConnections()).toEqual([]);
    expect(await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.userId, id))).toEqual([]);
  });

  it('"Apagar todos os dados" takes the Open Finance along', async () => {
    const { id, banks } = await newPerson();
    await banks.saveKey('id', 'segredo');
    await banks.addPending('a', null);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    try {
      await clearAccountData(db, id);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(await banks.getKey()).toBeNull();
    expect(await banks.listConnections()).toEqual([]);
  });
});
