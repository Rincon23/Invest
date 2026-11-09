import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { MonthClosedError, MonthNotFoundError } from '@/lib/storage/repository';
import { userAccess, type UserAccess } from './access';
import { PostgresBanksRepository } from './banks/repository';
import { getAuth } from './auth';
import { PostgresBudgetRepository } from './budgetRepository';
import { getDb } from './db';
import { PostgresDiagramRepository } from './diagramRepository';
import { HttpError } from './httpError';
import { allowedOriginHosts } from './origins';
import { PostgresNotificationsRepository } from './notificationsRepository';
import { PostgresPushRepository } from './push';
import { QuoteUnavailableError } from './quotes';
import { allowAttempt } from './rateLimit';
import { PostgresRemindersRepository } from './remindersRepository';
import { PostgresWalletRepository } from './walletRepository';

export { HttpError };

/**
 * Requests one account may make per minute, all kinds together and writes alone. Far above what
 * a person tapping around does (a screen loads a handful of things), far below a script: one
 * account alone can't wear the server out or fill its disk.
 */
const REQUESTS_PER_MINUTE = 300;
const WRITES_PER_MINUTE = 90;
/** Largest JSON body a route reads unless it asks for more (a backup does). */
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

interface RouteArgs<P> {
  request: NextRequest;
  params: P;
  /** Budget data (months, entries, settings) for the signed-in user. */
  repo: PostgresBudgetRepository;
  /** Carteira data (recorrentes, parcelados, reserva, caixa) for the same user. */
  wallet: PostgresWalletRepository;
  /** The Diagrama (targets per type, assets and scores, aportes). */
  diagram: PostgresDiagramRepository;
  /** The devices that receive this user's notifications. */
  push: PostgresPushRepository;
  /** Lembretes and daily tasks. */
  reminders: PostgresRemindersRepository;
  /** The in-app notification history (the bell / Central de notificações). */
  notifications: PostgresNotificationsRepository;
  /** Open Finance: the person's Pluggy key and banks (VIP; see lib/server/banks/access.ts). */
  banks: PostgresBanksRepository;
  userId: string;
  /** The signed-in user's e-mail, for the owner-only routes. */
  email: string | null;
  /** Whether this account runs the server and whether it is VIP (read once, when first asked). */
  access: () => Promise<UserAccess>;
}

/**
 * Wraps a Route Handler under /api/v1: rejects cross-origin writes, requires a session,
 * hands the handler the signed-in user's repository, and turns the result into JSON
 * (`undefined` → 204) and known errors into their status codes.
 */
export function apiRoute<P = Record<string, never>>(
  handler: (args: RouteArgs<P>) => Promise<unknown>,
) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      if (!isAllowedOrigin(request)) {
        throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Origem da requisição não permitida.');
      }

      const { headers: authHeaders, response: session } = await getAuth().api.getSession({
        headers: request.headers,
        returnHeaders: true,
      });
      if (!session) {
        throw new HttpError(401, 'UNAUTHENTICATED', 'Sessão expirada. Entre novamente para continuar.');
      }

      const userId = session.user.id;
      const writing = request.method !== 'GET' && request.method !== 'HEAD';
      if (
        !allowAttempt(`api:${userId}`, REQUESTS_PER_MINUTE, 60_000) ||
        (writing && !allowAttempt(`api-write:${userId}`, WRITES_PER_MINUTE, 60_000))
      ) {
        throw new HttpError(429, 'RATE_LIMITED', 'Muitas ações seguidas. Espere um minuto e tente de novo.');
      }

      const db = getDb();
      const repo = new PostgresBudgetRepository(db, session.user.id);
      const wallet = new PostgresWalletRepository(db, session.user.id, repo);
      let access: Promise<UserAccess> | undefined;
      const result = await handler({
        request,
        params: await context.params,
        repo,
        wallet,
        diagram: new PostgresDiagramRepository(db, session.user.id, repo),
        push: new PostgresPushRepository(db, session.user.id),
        reminders: new PostgresRemindersRepository(db, session.user.id),
        notifications: new PostgresNotificationsRepository(db, session.user.id),
        banks: new PostgresBanksRepository(db, session.user.id),
        userId: session.user.id,
        email: session.user.email ?? null,
        access: () => (access ??= userAccess(db, session.user.id, session.user.email ?? null)),
      });

      // A handler may build its own Response (e.g. a stream of progress events).
      const custom = result instanceof Response;
      const response = custom
        ? result
        : result === undefined
          ? new NextResponse(null, { status: 204 })
          : NextResponse.json(result);
      // Reading the session may refresh its cookie; pass that on to the browser.
      for (const cookie of authHeaders.getSetCookie()) response.headers.append('set-cookie', cookie);
      if (!custom) response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * Reads the body as text, refusing it (413) past `maxBytes` — by its Content-Length when it
 * declares one, and while reading when it doesn't (a chunked upload can't sneak past).
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const tooLarge = () => new HttpError(413, 'TOO_LARGE', 'Os dados enviados são grandes demais.');
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw tooLarge();
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Parses the JSON body with `schema`; malformed or invalid input becomes a 400, a huge one a 413. */
export async function readJson<T>(
  request: NextRequest,
  schema: ZodType<T>,
  { maxBytes = DEFAULT_MAX_BODY_BYTES }: { maxBytes?: number } = {},
): Promise<T> {
  const text = await readBodyText(request, maxBytes);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_INPUT', 'Corpo da requisição inválido.');
  }
  return schema.parse(body);
}

/**
 * Browsers always send `Origin` on writes; it must be this host (or one of the hostnames in
 * APP_ALLOWED_ORIGINS, when behind a proxy). Requests without it (not from a browser) are
 * not a CSRF risk and still need a valid session.
 */
function isAllowedOrigin(request: NextRequest): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return originHost === host || allowedOriginHosts().includes(originHost);
}

function jsonError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return NextResponse.json(
    { error: message, code, ...(details ? { details } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return jsonError(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) return jsonError(400, 'INVALID_INPUT', 'Dados inválidos.');
  if (err instanceof MonthClosedError) return jsonError(409, 'MONTH_CLOSED', err.message);
  if (err instanceof MonthNotFoundError) return jsonError(404, 'MONTH_NOT_FOUND', err.message);
  if (err instanceof QuoteUnavailableError) return jsonError(502, 'QUOTE_UNAVAILABLE', err.message);
  console.error('[api]', err);
  return jsonError(500, 'INTERNAL', 'Erro no servidor. Tente de novo.');
}
