import { formatDayMonth, zonedMoment } from '../reminders/time';
import { formatAgo } from './format';
import type { BankConnection, BankReserve } from './types';

/**
 * How a bank is doing, as the screen tells it. Pluggy's own status is not enough: a connection can
 * stop receiving data for days with everything green (Meu Pluggy issue #26, an Inter connection
 * that went 13 days without data and without an error), so the Capital watches the date itself.
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

/**
 * The line under "Reserva em conta" when the banks feed it: from where and how long ago ("BTG
 * Pactual · atualizado há 5 h"), or, when one of them stopped, that the value is the last one that
 * came. Null when nothing is marked. (No "pelo"/"pela": a bank's name has no known gender.)
 */
export function reserveStatusLine(
  reserve: BankReserve,
  now: number,
): { text: string; warning: boolean } | null {
  if (reserve.total === null) return null;
  const marked = reserve.banks.filter((bank) => bank.sources.some((source) => source.marked));
  if (marked.length === 0) return null;
  const names =
    marked.length === 1
      ? marked[0].name
      : `${marked
          .slice(0, -1)
          .map((bank) => bank.name)
          .join(', ')} e ${marked[marked.length - 1].name}`;
  const stopped = marked.find((bank) => connectionHealth(bank, now) !== 'ok');
  if (stopped) {
    const when = stopped.lastUpdatedAt ? formatDayMonth(zonedMoment(new Date(stopped.lastUpdatedAt)).date) : null;
    return {
      text: `${stopped.name}: sem dados novos; o valor é o último que chegou${when ? `, de ${when}` : ''}.`,
      warning: true,
    };
  }
  const oldest = marked
    .map((bank) => bank.lastUpdatedAt)
    .filter((date): date is string => date !== null)
    .sort()[0];
  return { text: `${names}${oldest ? ` · atualizado ${formatAgo(oldest, now)}` : ''}`, warning: false };
}
