import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The "Lançar ✅" button on the notice of a bill of "Contas do mês" works without a session, like
 * "Fatura paga ✅" (see `cardActionToken.ts`): the service worker may run long after the app was
 * last opened. The token, signed with ACTION_TOKEN_SECRET, allows one single thing — launching
 * this template, for this person, in this competence — and only while the notice is current.
 * It names its purpose, so a token issued for another button is never accepted here.
 */
export const RECURRING_ACTION_TOKEN_TTL_MS = 36 * 60 * 60 * 1000;

const PURPOSE = 'recurring-launch';

export interface RecurringLaunchAction {
  userId: string;
  recurringId: string;
  month: string;
}

interface Payload {
  p: string;
  u: string;
  r: string;
  m: string;
  /** Expiry, in epoch seconds. */
  e: number;
}

function secret(): string | null {
  const value = process.env.ACTION_TOKEN_SECRET?.trim();
  return value && value.length >= 16 ? value : null;
}

function sign(data: string, key: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

/** Null when the server has no ACTION_TOKEN_SECRET (the notification goes out without the button). */
export function signRecurringLaunch(action: RecurringLaunchAction, now: Date = new Date()): string | null {
  const key = secret();
  if (!key) return null;
  const payload: Payload = {
    p: PURPOSE,
    u: action.userId,
    r: action.recurringId,
    m: action.month,
    e: Math.floor((now.getTime() + RECURRING_ACTION_TOKEN_TTL_MS) / 1000),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data, key)}`;
}

export type VerifyRecurringResult =
  | { ok: true; action: RecurringLaunchAction }
  | { ok: false; reason: 'invalid' | 'expired' };

export function verifyRecurringLaunch(token: string, now: Date = new Date()): VerifyRecurringResult {
  const key = secret();
  const [data, signature, extra] = token.split('.');
  if (!key || !data || !signature || extra !== undefined) return { ok: false, reason: 'invalid' };

  const expected = Buffer.from(sign(data, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'invalid' };
  }

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Payload;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (
    payload.p !== PURPOSE ||
    typeof payload.u !== 'string' ||
    typeof payload.r !== 'string' ||
    typeof payload.m !== 'string' ||
    typeof payload.e !== 'number'
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (payload.e * 1000 < now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, action: { userId: payload.u, recurringId: payload.r, month: payload.m } };
}
