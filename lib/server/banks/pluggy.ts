import 'server-only';

/**
 * Pluggy's API (https://docs.pluggy.ai), with plain fetch (no SDK), for the Open Finance module.
 * Each person uses their own free Meu Pluggy application: the Client ID and Secret are theirs,
 * and the apiKey they trade for (it lasts 2 h) lives only in memory. Read-only: Pluggy cannot
 * move money, and a Meu Pluggy item cannot even be told to refresh.
 */

export const PLUGGY_API = 'https://api.pluggy.ai';
/** The Meu Pluggy connector: one item per bank the person authorizes at meu.pluggy.ai. */
export const MEU_PLUGGY_CONNECTOR_ID = 200;
const TIMEOUT_MS = 20_000;

/** The parts of a Pluggy item the Capital reads. */
export interface PluggyItem {
  id: string;
  /** UPDATED, UPDATING, WAITING_USER_INPUT, LOGIN_ERROR or OUTDATED. */
  status: string;
  executionStatus?: string | null;
  lastUpdatedAt?: string | null;
  nextAutoSyncAt?: string | null;
  consentExpiresAt?: string | null;
  parameter?: { type?: string | null; data?: unknown; expiresAt?: string | null } | null;
  /** Why the last update failed, in Pluggy's words. */
  error?: { code?: string | null; message?: string | null } | null;
  userAction?: { attributes?: Record<string, unknown> | null } | null;
}

/** The parts of a Pluggy account the Capital reads. */
export interface PluggyAccount {
  id: string;
  type?: string | null;
  subtype?: string | null;
  name?: string | null;
  marketingName?: string | null;
  balance?: number | null;
  currencyCode?: string | null;
  bankData?: { transferNumber?: string | null } | null;
  creditData?: {
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
    balanceDueDate?: string | null;
  } | null;
}

/** The parts of a Pluggy investment the Capital keeps (GET /investments). */
export interface PluggyInvestment {
  id: string;
  name?: string | null;
  type?: string | null;
  subtype?: string | null;
  /** The B3 ticker of a stock or fund ("PETR4"); the bank's own code for the rest. */
  code?: string | null;
  isin?: string | null;
  /** Shares or quotas held. */
  quantity?: number | null;
  /** The value today (what a reserve counts). */
  balance?: number | null;
}

interface PluggyParty {
  name?: string | null;
  documentNumber?: { value?: string | null } | null;
}

/** The parts of a Pluggy transaction the Capital keeps (GET /v2/transactions). */
export interface PluggyTransaction {
  id: string;
  accountId?: string | null;
  date: string;
  amount: number;
  currencyCode?: string | null;
  description?: string | null;
  descriptionRaw?: string | null;
  type?: string | null;
  status?: string | null;
  category?: string | null;
  operationType?: string | null;
  paymentData?: {
    paymentMethod?: string | null;
    payer?: PluggyParty | null;
    receiver?: PluggyParty | null;
  } | null;
  merchant?: { name?: string | null; businessName?: string | null } | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    purchaseDate?: string | null;
    billId?: string | null;
  } | null;
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

/**
 * Where the person authorizes a new item. Meu Pluggy puts it in `parameter.data` (type "oauth"),
 * a moment after the item is created; the other places are where Pluggy's other OAuth flows put it.
 */
export function authorizeUrlOf(item: PluggyItem | null | undefined): string | null {
  if (!item) return null;
  const data = item.parameter?.data;
  if (isHttpsUrl(data)) return data;
  for (const value of Object.values(item.userAction?.attributes ?? {})) if (isHttpsUrl(value)) return value;
  return null;
}

export type FetchLike = typeof fetch;

/** A refusal from Pluggy. `code` is its `codeDescription` ("LIST_ITEMS_FEATURE_NOT_ENABLED"). */
export class PluggyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'PluggyError';
  }
}

/** What one call answered, whatever the status. */
export interface PluggyReply {
  status: number;
  body: unknown;
}

/** Pluggy's error body: `{ code: 400, message, codeDescription }`. */
export function pluggyErrorOf(reply: PluggyReply): PluggyError {
  const body = (reply.body ?? {}) as { message?: unknown; codeDescription?: unknown; code?: unknown };
  const code =
    typeof body.codeDescription === 'string'
      ? body.codeDescription
      : typeof body.code === 'string'
        ? body.code
        : null;
  const message = typeof body.message === 'string' ? body.message : `HTTP ${reply.status}`;
  return new PluggyError(reply.status, code, message);
}

async function send(
  fetchImpl: FetchLike,
  method: string,
  path: string,
  { apiKey, body }: { apiKey?: string; body?: unknown },
): Promise<PluggyReply> {
  const response = await fetchImpl(`${PLUGGY_API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: response.status, body: parsed };
}

/** POST /auth: trades the person's Client ID and Secret for an apiKey (valid for 2 h). */
export async function pluggyApiKey(
  clientId: string,
  clientSecret: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const reply = await send(fetchImpl, 'POST', '/auth', { body: { clientId, clientSecret } });
  const apiKey = (reply.body as { apiKey?: unknown } | null)?.apiKey;
  if (reply.status >= 300 || typeof apiKey !== 'string' || !apiKey) throw pluggyErrorOf(reply);
  return apiKey;
}

export class PluggyClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** One call, whatever it answers (refusals included). */
  call(method: string, path: string, body?: unknown): Promise<PluggyReply> {
    return send(this.fetchImpl, method, path, { apiKey: this.apiKey, body });
  }

  /** A GET that must succeed; anything else becomes a PluggyError. */
  async get<T>(path: string): Promise<T> {
    const reply = await this.call('GET', path);
    if (reply.status >= 300) throw pluggyErrorOf(reply);
    return reply.body as T;
  }

  /**
   * Every page of GET /v2/transactions for one account between two days (YYYY-MM-DD). The v2 list
   * pages by cursor: each answer's `next` is the address of the following page (a full URL or
   * just its query string), until it comes back empty.
   */
  async allTransactions<T = PluggyTransaction>(
    accountId: string,
    dateFrom: string,
    dateTo: string,
    maxPages = 50,
  ): Promise<T[]> {
    const first = new URLSearchParams({ accountId, dateFrom, dateTo });
    let path: string | null = `/v2/transactions?${first}`;
    const all: T[] = [];
    for (let page = 0; path && page < maxPages; page++) {
      const body: { results?: T[]; next?: unknown } = await this.get(path);
      all.push(...(body.results ?? []));
      path = typeof body.next === 'string' && body.next ? nextPagePath(body.next, first) : null;
    }
    return all;
  }
}

/**
 * The path of the page `next` points at, on Pluggy's own host only. The account and the days are
 * put back when `next` leaves them out.
 */
export function nextPagePath(next: string, first: URLSearchParams): string | null {
  // A bare query string ("after=…") is relative to the list itself.
  const relative = /^(https?:|\/|\?)/i.test(next) ? next : `?${next}`;
  let url: URL;
  try {
    url = new URL(relative, `${PLUGGY_API}/v2/transactions`);
  } catch {
    return null;
  }
  if (url.origin !== PLUGGY_API) return null;
  for (const [key, value] of first) if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return `${url.pathname}?${url.searchParams}`;
}
