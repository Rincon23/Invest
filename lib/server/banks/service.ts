import 'server-only';
import { accountDisplayName, accountKind, MEU_PLUGGY_LIMIT, suggestBankName } from '@/lib/banks';
import { addDays, zonedMoment } from '@/lib/reminders/time';
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
  type PluggyTransaction,
} from './pluggy';
import type {
  ConnectionUpdate,
  PostgresBanksRepository,
  StoredTransaction,
  SyncedConnection,
} from './repository';

/**
 * The Open Finance flows the screen drives: checking and saving the person's key, bringing a bank
 * (create the Meu Pluggy item, send the person to authorize it, read it when they come back),
 * removing one and disconnecting everything. Every call to Pluggy is made here, on the server.
 */

/** Pluggy's apiKey lasts 2 h; it is renewed a little before. Only in memory, never stored. */
const API_KEY_TTL_MS = 110 * 60_000;
/** A pending item still waiting for its authorization this long after the link expired was given up. */
const GIVE_UP_AFTER_MS = 2 * 60_000;

const globalForBanks = globalThis as unknown as {
  __capitalPluggyKeys?: Map<string, { clientId: string; apiKey: string; expiresAt: number }>;
};
const apiKeys = (globalForBanks.__capitalPluggyKeys ??= new Map());

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
    throw new HttpError(503, 'NEEDS_HTTPS', 'Trazer bancos só funciona pelo endereço seguro (https) do Capital +.');
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

/** Pluggy's status of an item, in the Capital's words. */
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

/** The day of a Pluggy timestamp in São Paulo ("2026-10-18T03:00:00.000Z" → "2026-10-18"). */
function dayOf(value: string | null | undefined): string | null {
  const date = toDate(value);
  return date ? zonedMoment(date).date : null;
}

/**
 * Reads an item's accounts into the database, with their balance as of `balanceAt`; answers the
 * accounts Pluggy sent and the name the Capital suggests for the bank (null when none came).
 */
async function readAccounts(
  repo: PostgresBanksRepository,
  client: PluggyClient,
  itemId: string,
  balanceAt: Date | null,
): Promise<{ accounts: PluggyAccount[]; suggestedName: string | null }> {
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
  await repo.replaceAccounts(
    itemId,
    results.map((account, index) => ({
      accountId: account.id,
      kind: accountKind(account.subtype),
      name: accountDisplayName(names[index]),
      balance: numberOrNull(account.balance),
      currency: account.currencyCode ?? null,
      balanceAt,
      creditLimit: numberOrNull(account.creditData?.creditLimit),
      availableCredit: numberOrNull(account.creditData?.availableCreditLimit),
      dueDate: dayOf(account.creditData?.balanceDueDate),
    })),
  );
  return { accounts: results, suggestedName: results.length > 0 ? suggestBankName(names) : null };
}

/**
 * Reads an item's investments (they can feed the Reserva). Best effort: a bank whose investments
 * fail to come still has its accounts and transactions read.
 */
async function readInvestments(
  repo: PostgresBanksRepository,
  client: PluggyClient,
  itemId: string,
  balanceAt: Date | null,
): Promise<void> {
  try {
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
  } catch (err) {
    console.warn(
      `[bancos] investimentos do item ${itemId.slice(0, 8)} não vieram:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** A Pluggy transaction as the Capital keeps it. */
export function transactionRow(transaction: PluggyTransaction, accountId: string): StoredTransaction {
  const payment = transaction.paymentData;
  const card = transaction.creditCardMetadata;
  const integerOrNull = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : null);
  return {
    transactionId: transaction.id,
    accountId,
    date: dayOf(transaction.date) ?? zonedMoment(new Date()).date,
    amount: transaction.amount,
    currency: transaction.currencyCode ?? null,
    description: (transaction.description || transaction.descriptionRaw || '').trim(),
    descriptionRaw: transaction.descriptionRaw ?? null,
    type: transaction.type ?? (transaction.amount < 0 ? 'DEBIT' : 'CREDIT'),
    status: transaction.status ?? 'POSTED',
    category: transaction.category ?? null,
    operationType: transaction.operationType ?? null,
    paymentMethod: payment?.paymentMethod ?? null,
    payerName: payment?.payer?.name ?? null,
    payerDocument: payment?.payer?.documentNumber?.value ?? null,
    receiverName: payment?.receiver?.name ?? null,
    receiverDocument: payment?.receiver?.documentNumber?.value ?? null,
    merchantName: transaction.merchant?.name ?? transaction.merchant?.businessName ?? null,
    installmentNumber: integerOrNull(card?.installmentNumber),
    totalInstallments: integerOrNull(card?.totalInstallments),
    purchaseDate: dayOf(card?.purchaseDate),
    billId: card?.billId ?? null,
  };
}

/** Reads one arriving item into the database (its accounts, once it is done); answers its status. */
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
    // The transactions come with the next sync (the job, or "Buscar novidades"): a year of them
    // takes a while, and the screen is waiting. The investments are one call: they come now, so
    // "Conferir investimentos" works as soon as the bank arrives.
    const { suggestedName } = await readAccounts(repo, client, item.id, lastUpdatedAt);
    if (suggestedName) update.suggestedName = suggestedName;
    await readInvestments(repo, client, item.id, lastUpdatedAt);
  }
  await repo.updateConnection(item.id, update);
  return status;
}

/**
 * The banks still on their way (just authorized, or the person never finished): reads each one.
 * The ones that arrived get their accounts and a suggested name; the ones whose link expired long
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

/** How far back the first read goes (Open Finance hands about a year). */
const FIRST_READ_DAYS = 365;
/** A later read goes back this far before the last one: a pending one may have changed meanwhile. */
const REREAD_DAYS = 7;

/** What one bank's sync brought. */
export interface BankSyncResult {
  itemId: string;
  /** Whether the bank had sent new data since the last read. */
  changed: boolean;
  /** The transactions seen for the first time. */
  added: string[];
  /** The bank's first read (a year back): nothing in it is news to alert about. */
  firstRead: boolean;
}

/**
 * Asks Pluggy about one bank that already arrived. Only when the bank sent data since the last
 * read (its `lastUpdatedAt` moved) are the accounts and the transactions read again: from a year
 * back the first time, then from the last read minus 7 days. A transaction is kept by its id, so
 * reading it again only updates it.
 */
export async function syncConnection(
  repo: PostgresBanksRepository,
  client: PluggyClient,
  connection: SyncedConnection,
  now: Date,
): Promise<BankSyncResult> {
  const unchanged: BankSyncResult = { itemId: connection.itemId, changed: false, added: [], firstRead: false };
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

  const { accounts, suggestedName } = await readAccounts(repo, client, connection.itemId, lastUpdatedAt);
  if (suggestedName) update.suggestedName = suggestedName;
  await readInvestments(repo, client, connection.itemId, lastUpdatedAt);
  const today = zonedMoment(now).date;
  const from = connection.syncedUpdateAt
    ? addDays(zonedMoment(connection.syncedUpdateAt).date, -REREAD_DAYS)
    : addDays(today, -FIRST_READ_DAYS);
  const added: string[] = [];
  for (const account of accounts) {
    const transactions = await client.allTransactions(account.id, from, today);
    added.push(...(await repo.upsertTransactions(transactions.map((t) => transactionRow(t, account.id)))));
  }
  // Only once everything is in: a read that broke halfway is done again next time.
  update.syncedUpdateAt = lastUpdatedAt;
  await repo.updateConnection(connection.itemId, update);
  return { itemId: connection.itemId, changed: true, added, firstRead: connection.syncedUpdateAt === null };
}

const globalForSync = globalThis as unknown as { __capitalBanksSyncing?: Set<string> };
const syncing = (globalForSync.__capitalBanksSyncing ??= new Set());

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
    // The Reserva follows the balances the person marked, when they changed.
    if (results.some((result) => result.changed)) await repo.writeReserve();
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
      // Already gone, or Pluggy away: the Capital forgets it anyway.
    }
  }
}

/** Takes one bank out of the Capital (and out of the person's Pluggy application). */
export async function removeConnection(
  repo: PostgresBanksRepository,
  userId: string,
  itemId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!(await repo.hasConnection(itemId))) {
    throw new HttpError(404, 'NOT_FOUND', 'Este banco não está mais no Capital +.');
  }
  try {
    await removeItems(await clientFor(repo, userId, fetchImpl), [itemId]);
  } catch {
    // Without the key or Pluggy, the bank still leaves the Capital.
  }
  await repo.deleteConnections([itemId]);
}

/**
 * "Desconectar": every bank leaves the person's Pluggy application, and the key and the banks leave
 * the Capital. The banks stay connected in Meu Pluggy itself, where the person removes them if they
 * want to.
 */
export async function disconnectAll(
  repo: PostgresBanksRepository,
  userId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const itemIds = await repo.itemIds();
  if (itemIds.length > 0) {
    try {
      await removeItems(await clientFor(repo, userId, fetchImpl), itemIds);
    } catch {
      // The key no longer works: nothing to remove at Pluggy from here.
    }
  }
  await repo.deleteAll();
  forgetPluggyKey(userId);
}
