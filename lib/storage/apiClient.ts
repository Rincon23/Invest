import { NotAuthenticatedError } from './repository';

/** Dispatched on `window` when the API says the session is gone; AuthProvider sends the user to /login. */
export const UNAUTHENTICATED_EVENT = 'capital:unauthenticated';
/** Fired after anything is saved: the Missões check what was just done (`MissionsProvider`). */
export const DATA_CHANGED_EVENT = 'capital:data-changed';

/** A failed API call. `message` is user-facing (pt-BR), straight from the server when it sent one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Extra facts the server sent with the error, when the screen can act on them. */
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Encodes one path segment (ids and month keys come from data). */
export const seg = encodeURIComponent;

/**
 * One call to the app's own API (same origin, session cookie). A 204 resolves to undefined,
 * a 401 sends the app to /login, and every other error carries the server's own message.
 */
export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(
      'Sem conexão com o servidor. Verifique a internet e tente de novo.',
      0,
      'NETWORK',
    );
  }

  if (response.ok && method !== 'GET' && !path.startsWith('/missions') && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  }
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload as T;

  if (response.status === 401) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    throw new NotAuthenticatedError();
  }
  const { error, code, details } = (payload ?? {}) as {
    error?: string;
    code?: string;
    details?: Record<string, unknown>;
  };
  throw new ApiRequestError(error || 'Erro ao acessar os dados.', response.status, code, details);
}
