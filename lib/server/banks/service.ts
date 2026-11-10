import 'server-only';
import { MEU_PLUGGY_LIMIT, suggestBankName } from '@/lib/banks';
import { appBaseUrl } from '../appUrl';
import { HttpError } from '../httpError';
import {
  authorizeUrlOf,
  MEU_PLUGGY_CONNECTOR_ID,
  PluggyClient,
  pluggyApiKey,
  PluggyError,
  pluggyErrorOf,
  type FetchLike,
  type PluggyAccount,
  type PluggyInvestment,
  type PluggyItem,
} from './pluggy';
import type { ConnectionUpdate, PostgresBanksRepository, SyncedConnection } from './repository';

/**
 * The Open Finance flows the screen drives: checking and saving the person's key, bringing a broker
 * (create the Meu Pluggy item, send the person to authorize it, read it when they come back),
 * removing one and disconnecting everything. Only the investments are read: they are what the
 * Diagrama is checked against. Every call to Pluggy is made here, on the server.
 */

/** Pluggy's apiKey lasts 2 h; it is renewed a little before. Only in memory, never stored. */
const API_KEY_TTL_MS = 110 * 60_000;
/** A pending item still waiting for its authorization this long after the link expired was given up. */
const GIVE_UP_AFTER_MS = 2 * 60_000;

const globalForBanks = globalThis as unknown as {
  __investPluggyKeys?: Map<string, { clientId: string; apiKey: string; expiresAt: number }>;
};
const apiKeys = (globalForBanks.__investPluggyKeys ??= new Map());

export function forgetPluggyKey(userId: string): void {
  apiKeys.delete(userId);
}

const unavailable = () =>
  new HttpError(502, 'PLUGGY_UNAVAILABLE', 'A Pluggy não respondeu. Tente de novo em alguns minutos.');

function keyRefused(): HttpError {
  return new HttpError(
    400,
    'INVALID_KEY',
    'O Client ID ou o Client Secret não confere. Copie os dois de novo do dashboard da Pluggy.',
  );
}

async function apiKeyFor(
  userId: string,
  credentials: { clientId: string; clientSecret: string },
  fetchImpl: FetchLike,
  now = Date.now(),
): Promise<string> {
  const cached = apiKeys.get(userId);
  if (cached && cached.clientId === credentials.clientId && cached.expiresAt > now) return cached.apiKey;
  try {
    const apiKey = await pluggyApiKey(credentials.clientId, credentials.clientSecret, fetchImpl);
    apiKeys.set(userId, { clientId: credentials.clientId, apiKey, expiresAt: now + API_KEY_TTL_MS });
    return apiKey;
  } catch (err) {
    if (err instanceof PluggyError && err.status < 500) throw keyRefused();
    throw unavailable();
  }
}

/** A client with the person's key, or 409 when they haven't saved one. */
async function clientFor(
  repo: PostgresBanksRepository,
  userId: string,
  fetchImpl: FetchLike,
): Promise<PluggyClient> {
  const credentials = await repo.getCredentials();
  if (!credentials) {
    throw new HttpError(409, 'NO_KEY', 'Falta a sua chave da Pluggy. Siga o passo "Cole aqui a sua chave".');
  }
  return new PluggyClient(await apiKeyFor(userId, credentials, fetchImpl), fetchImpl);
}

/** Step 3: Pluggy must accept the key before it is saved (encrypted). */
export async function checkAndSaveKey(
  repo: PostgresBanksRepository,
  userId: string,
  key: { clientId: string; clientSecret: string },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  forgetPluggyKey(userId);
  await apiKeyFor(userId, key, fetchImpl);
  await repo.saveKey(key.clientId, key.clientSecret);
}

/**
 * Where Pluggy sends the person back after the authorization: the Open Finance screen. It must be
 * HTTPS (Pluggy refuses anything else, localhost included); PLUGGY_REDIRECT_URI overrides it, for
 * trying it out from a development machine.
 */
export function banksRedirectUri(): string | null {
  const uri = process.env.PLUGGY_REDIRECT_URI?.trim() || `${appBaseUrl()}/bancos`;
  return /^https:\/\//i.test(uri) && !/^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(uri) ? uri : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Step 4: creates the Meu Pluggy item and answers the address where the person picks one bank and
 * authorizes it. The address works for 4 minutes, so this runs only when they tap.
 */
export async function startConnection(
  repo: PostgresBanksRepository,
  userId: string,
  fetchImpl: FetchLike = fetch,
  { pollMs = 1000, pollTimes = 10 }: { pollMs?: number; pollTimes?: number } = {},
): Promise<{ authorizeUrl: string }> {
  const redirectUri = banksRedirectUri();
  if (!redirectUri) {
    throw new HttpError(503, 'NEEDS_HTTPS', 'Trazer bancos só funciona pelo endereço seguro (https) do Invest +.');
  }
  if ((await repo.itemIds()).length >= MEU_PLUGGY_LIMIT) {
    throw new HttpError(
      409,
      'LIMIT',
      `O Meu Pluggy conecta até ${MEU_PLUGGY_LIMIT} bancos de graça. Tire um banco para trazer outro.`,
    );
  }
  const client = await clientFor(repo, userId, fetchImpl);

  let item: PluggyItem;
  try {
    const reply = await client.call('POST', '/items', {
      connectorId: MEU_PLUGGY_CONNECTOR_ID,
      parameters: {},
      oauthRedirectUri: redirectUri,
      clientUserId: userId,
    });
    if (reply.status >= 300) {
      // Pluggy's own reason, for whoever reads the server log (it never carries the key).
      const refusal = pluggyErrorOf(reply);
      console.warn(`[bancos] a Pluggy recusou criar o item: ${reply.status} ${refusal.code ?? ''} ${refusal.message}`);
    }
    if (reply.status >= 500) throw unavailable();
    // Since 2026-11 Pluggy's free plan only creates items through its Connect Widget.
    if (reply.status >= 300 && pluggyErrorOf(reply).code === 'CREATE_ITEMS_API_FREE_DISABLED') {
      throw new HttpError(
        409,
        'PLUGGY_WIDGET_ONLY',
        'A Pluggy não deixa mais trazer bancos por aqui no plano grátis. As suas corretoras vêm das conexões que você já tem no Capital\u00a0+.',
      );
    }
    if (reply.status >= 300) {
      throw new HttpError(
        502,
        'PLUGGY_REFUSED',
        'A Pluggy não aceitou trazer o banco. Confira se o conector MeuPluggy está ativo na sua aplicação do dashboard.',
      );
    }
    item = reply.body as PluggyItem;
    if (typeof item?.id !== 'string' || !item.id) throw unavailable();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw unavailable();
  }
  await repo.addPending(item.id, null);

  let url = authorizeUrlOf(item);
  for (let i = 0; !url && i < pollTimes; i++) {
    await sleep(pollMs);
    try {
      item = await client.get<PluggyItem>(`/items/${encodeURIComponent(item.id)}`);
      url = authorizeUrlOf(item);
    } catch {
      break;
    }
  }
  if (!url) {
    await removeItems(client, [item.id]);
    await repo.deleteConnections([item.id]);
    throw new HttpError(502, 'NO_AUTHORIZE_LINK', 'A Pluggy não mandou o link para autorizar. Tente de novo.');
  }
  await repo.setAuthorizeExpiry(item.id, toDate(item.parameter?.expiresAt));
  return { authorizeUrl: url };
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Pluggy's status of an item, in the app's words. */
export function connectionStatusOf(item: PluggyItem): ConnectionUpdate['status'] {
  switch (item.status) {
    case 'UPDATED':
      return 'ok';
    case 'LOGIN_ERROR':
      return 'reconnect';
    case 'OUTDATED':
      return 'error';
    default:
      return 'pending';
  }
}

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * The name the app suggests for a bank, from its accounts (null when none came). The accounts are
 * read only for that: nothing of them is kept.
 */
async function suggestedNameOf(client: PluggyClient, itemId: string): Promise<string | null> {
  try {
    const { results = [] } = await client.get<{ results?: PluggyAccount[] }>(
      `/accounts?itemId=${encodeURIComponent(itemId)}`,
    );
    const names = results.map((account) => ({
      type: account.type,
      subtype: account.subtype,
      name: account.name,
      marketingName: account.marketingName,
      transferNumber: account.bankData?.transferNumber,
    }));
    return names.length > 0 ? suggestBankName(names) : null;
  } catch {
    return null;
  }
}

/** Reads an item's investments into the database, with their balance as of `balanceAt`. */
async function readInvestments(
  repo: PostgresBanksRepository,
  client: PluggyClient,
  itemId: string,
  balanceAt: Date | null,
): Promise<void> {
  const { results = [] } = await client.get<{ results?: PluggyInvestment[] }>(
    `/investments?itemId=${encodeURIComponent(itemId)}`,
  );
  await repo.replaceInvestments(
    itemId,
    results.map((investment) => ({
      investmentId: investment.id,
      name: (investment.name ?? '').trim() || 'Investimento',
      type: investment.type ?? null,
      subtype: investment.subtype ?? null,
      code: investment.code?.trim() || null,
      isin: investment.isin?.trim() || null,
      quantity: numberOrNull(investment.quantity),
      balance: numberOrNull(investment.balance),
      balanceAt,
    })),
  );
}

/** Reads one arriving item into the database (its investments, once it is done); answers its status. */
async function readItem(
  repo: PostgresBanksRepository,
  client: PluggyClient,
  item: PluggyItem,
): Promise<ConnectionUpdate['status']> {
  const status = connectionStatusOf(item);
  const lastUpdatedAt = toDate(item.lastUpdatedAt);
  const update: ConnectionUpdate = {
    status,
    lastUpdatedAt,
    nextAutoSyncAt: toDate(item.nextAutoSyncAt),
    consentExpiresAt: toDate(item.consentExpiresAt),
  };
  if (status === 'ok') {
    // The investments are one call: they come now, so "Conferir investimentos" works as soon as
    // the bank arrives.
    const suggestedName = await suggestedNameOf(client, item.id);
    if (suggestedName) update.suggestedName = suggestedName;
    try {
      await readInvestments(repo, client, item.id, lastUpdatedAt);
      update.syncedUpdateAt = lastUpdatedAt;
    } catch (err) {
      // The bank arrived anyway; the next sync reads its investments again.
      console.warn(
        `[bancos] investimentos do item ${item.id.slice(0, 8)} não vieram:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  await repo.updateConnection(item.id, update);
  return status;
}

/**
 * The banks still on their way (just authorized, or the person never finished): reads each one.
 * The ones that arrived get their investments and a suggested name; the ones whose link expired long
 * ago without an authorization are removed, here and at Pluggy. Answers how many were given up.
 */
export async function refreshPending(
  repo: PostgresBanksRepository,
  userId: string,
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<{ givenUp: number }> {
  const pending = await repo.pendingConnections();
  if (pending.length === 0) return { givenUp: 0 };
  let client: PluggyClient;
  try {
    client = await clientFor(repo, userId, fetchImpl);
  } catch {
    // Pluggy away or the key refused: the banks stay "chegando" and the screen says so later.
    return { givenUp: 0 };
  }

  const abandoned: string[] = [];
  for (const connection of pending) {
    try {
      const reply = await client.call('GET', `/items/${encodeURIComponent(connection.itemId)}`);
      if (reply.status === 404) {
        abandoned.push(connection.itemId);
        continue;
      }
      if (reply.status >= 300) continue;
      const item = reply.body as PluggyItem;
      // How each bank ended (never its data): the server log is where a Pluggy failure shows up.
      if (item.status !== 'UPDATING' && item.status !== 'WAITING_USER_INPUT') {
        console.log(
          `[bancos] item ${connection.itemId.slice(0, 8)} na Pluggy: ${item.status}/${item.executionStatus ?? '-'}` +
            (item.error ? ` erro ${item.error.code ?? '-'}: ${item.error.message ?? ''}` : ''),
        );
      }
      const waiting = item.status === 'WAITING_USER_INPUT';
      const deadline = (connection.authorizeExpiresAt ?? new Date(connection.createdAt.getTime() + 4 * 60_000))
        .getTime();
      if (waiting && now.getTime() > deadline + GIVE_UP_AFTER_MS) {
        abandoned.push(connection.itemId);
        continue;
      }
      await readItem(repo, client, item);
    } catch {
      // One bank that fails to read never stops the others; it is read again on the next visit.
    }
  }
  if (abandoned.length > 0) {
    await removeItems(client, abandoned);
    await repo.deleteConnections(abandoned);
  }
  return { givenUp: abandoned.length };
}

/** What one bank's sync brought. */
export interface BankSyncResult {
  itemId: string;
  /** Whether the bank had sent new data since the last read. */
  changed: boolean;
}

/**
 * Asks Pluggy about one bank that already arrived. Only when the bank sent data since the last
 * read (its `lastUpdatedAt` moved) are the investments read again.
 */
export async function syncConnection(
  repo: PostgresBanksRepository,
  client: PluggyClient,
  connection: SyncedConnection,
  now: Date,
): Promise<BankSyncResult> {
  const unchanged: BankSyncResult = { itemId: connection.itemId, changed: false };
  const reply = await client.call('GET', `/items/${encodeURIComponent(connection.itemId)}`);
  if (reply.status === 404) {
    // Gone at Pluggy (revoked or deleted there): the person brings it again.
    await repo.updateConnection(connection.itemId, { status: 'reconnect', checkedAt: now });
    return unchanged;
  }
  if (reply.status >= 300) throw pluggyErrorOf(reply);
  const item = reply.body as PluggyItem;

  // While Pluggy updates an item (once a day) it says UPDATING: the bank keeps the status it had.
  const said = connectionStatusOf(item);
  const status = said === 'pending' ? connection.status : said;
  if (status !== 'ok') {
    console.log(
      `[bancos] item ${connection.itemId.slice(0, 8)} na Pluggy: ${item.status}/${item.executionStatus ?? '-'}` +
        (item.error ? ` erro ${item.error.code ?? '-'}: ${item.error.message ?? ''}` : ''),
    );
  }
  const lastUpdatedAt = toDate(item.lastUpdatedAt);
  const update: ConnectionUpdate = {
    status,
    lastUpdatedAt,
    nextAutoSyncAt: toDate(item.nextAutoSyncAt),
    consentExpiresAt: toDate(item.consentExpiresAt),
    checkedAt: now,
  };
  const fresh =
    item.status === 'UPDATED' &&
    lastUpdatedAt !== null &&
    (!connection.syncedUpdateAt || lastUpdatedAt > connection.syncedUpdateAt);
  if (!fresh) {
    await repo.updateConnection(connection.itemId, update);
    return unchanged;
  }

  const suggestedName = await suggestedNameOf(client, connection.itemId);
  if (suggestedName) update.suggestedName = suggestedName;
  try {
    await readInvestments(repo, client, connection.itemId, lastUpdatedAt);
  } catch (err) {
    // What Pluggy said about the bank still counts; its investments are read again next time.
    await repo.updateConnection(connection.itemId, update);
    throw err;
  }
  // Only once everything is in: a read that broke halfway is done again next time.
  update.syncedUpdateAt = lastUpdatedAt;
  await repo.updateConnection(connection.itemId, update);
  return { itemId: connection.itemId, changed: true };
}

const globalForSync = globalThis as unknown as { __investBanksSyncing?: Set<string> };
const syncing = (globalForSync.__investBanksSyncing ??= new Set());

/**
 * Everything of one person: the banks on their way, then every bank that already arrived. A bank
 * that fails doesn't stop the others. Answers null when a sync of this person is already running
 * (the job and "Buscar novidades" at the same moment).
 */
export async function syncUser(
  repo: PostgresBanksRepository,
  userId: string,
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<BankSyncResult[] | null> {
  if (syncing.has(userId)) return null;
  syncing.add(userId);
  try {
    await refreshPending(repo, userId, fetchImpl, now);
    const connections = await repo.connectionsToSync();
    if (connections.length === 0) return [];
    const client = await clientFor(repo, userId, fetchImpl);
    const results: BankSyncResult[] = [];
    for (const connection of connections) {
      try {
        results.push(await syncConnection(repo, client, connection, now));
      } catch (err) {
        if (err instanceof PluggyError && (err.status === 401 || err.status === 403)) forgetPluggyKey(userId);
        console.error(
          `[bancos] falha ao ler o item ${connection.itemId.slice(0, 8)}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return results;
  } finally {
    syncing.delete(userId);
  }
}

/** Deletes items at Pluggy (which also revokes their authorization); a failure doesn't stop the rest. */
async function removeItems(client: PluggyClient, itemIds: string[]): Promise<void> {
  for (const itemId of itemIds) {
    try {
      await client.call('DELETE', `/items/${encodeURIComponent(itemId)}`);
    } catch {
      // Already gone, or Pluggy away: the app forgets it anyway.
    }
  }
}

/**
 * Takes one bank out of the Invest + only. The item stays at Pluggy: the same connection usually
 * serves the Capital + too (both apps read it with the person's own key, and the free plan creates
 * items only through Pluggy's widget), so deleting it there would cut it off in the other app.
 */
export async function removeConnection(repo: PostgresBanksRepository, itemId: string): Promise<void> {
  if (!(await repo.hasConnection(itemId))) {
    throw new HttpError(404, 'NOT_FOUND', 'Este banco não está mais no Invest +.');
  }
  await repo.deleteConnections([itemId]);
}

/**
 * "Desconectar": the key and the banks leave the Invest +. The connections stay at Pluggy and in
 * Meu Pluggy (the Capital + may use them), where the person removes them if they want to.
 */
export async function disconnectAll(repo: PostgresBanksRepository, userId: string): Promise<void> {
  await repo.deleteAll();
  forgetPluggyKey(userId);
}
