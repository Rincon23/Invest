import type { BankConnection } from './types';

/**
 * How a bank is doing, as the screen tells it. Pluggy's own status is not enough: a connection can
 * stop receiving data for days with everything green (Meu Pluggy issue #26, an Inter connection
 * that went 13 days without data and without an error), so the app watches the date itself.
 */

/** Without data from the bank for longer than this, the connection counts as stopped. */
export const STALE_AFTER_HOURS = 48;
/** The warning before the authorization runs out. */
export const CONSENT_WARNING_DAYS = 15;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** `pending`, `ok`, `error` and `reconnect` as Pluggy said; `stale` when the bank went quiet. */
export type BankHealth = BankConnection['status'] | 'stale';

export function connectionHealth(
  connection: Pick<BankConnection, 'status' | 'lastUpdatedAt'>,
  now: number,
): BankHealth {
  if (connection.status !== 'ok') return connection.status;
  if (!connection.lastUpdatedAt) return 'ok';
  return now - new Date(connection.lastUpdatedAt).getTime() > STALE_AFTER_HOURS * HOUR_MS ? 'stale' : 'ok';
}

/** Days until the authorization runs out, only when that is close (0 = runs out today or already did). */
export function consentDaysLeft(connection: Pick<BankConnection, 'consentExpiresAt'>, now: number): number | null {
  if (!connection.consentExpiresAt) return null;
  const left = Math.ceil((new Date(connection.consentExpiresAt).getTime() - now) / DAY_MS);
  return left <= CONSENT_WARNING_DAYS ? Math.max(0, left) : null;
}
