import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The "Realizado ✅" button on a notification works without a session: the service worker may
 * run when the app has not been opened for days and the cookie is gone. Instead, the button
 * carries a token signed with ACTION_TOKEN_SECRET that allows exactly one thing — completing
 * this reminder, for this user, up to this day — and only for 36 hours.
 */
export const ACTION_TOKEN_TTL_MS = 36 * 60 * 60 * 1000;

export interface ReminderAction {
  userId: string;
  reminderId: string;
  dueDate: string;
}

interface Payload {
  u: string;
  r: string;
  d: string;
  /** Expiry, in epoch seconds. */
  e: number;
}

function secret(): string | null {
  const value = process.env.ACTION_TOKEN_SECRET?.trim();
  return value && value.length >= 16 ? value : null;
}

export function canSignActions(): boolean {
  return secret() !== null;
}

function sign(data: string, key: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

/** Null when the server has no ACTION_TOKEN_SECRET (the notification goes out without the button). */
export function signReminderAction(action: ReminderAction, now: Date = new Date()): string | null {
  const key = secret();
  if (!key) return null;
  const payload: Payload = {
    u: action.userId,
    r: action.reminderId,
    d: action.dueDate,
    e: Math.floor((now.getTime() + ACTION_TOKEN_TTL_MS) / 1000),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data, key)}`;
}

export type VerifyResult = { ok: true; action: ReminderAction } | { ok: false; reason: 'invalid' | 'expired' };

export function verifyReminderAction(token: string, now: Date = new Date()): VerifyResult {
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
    typeof payload.u !== 'string' ||
    typeof payload.r !== 'string' ||
    typeof payload.d !== 'string' ||
    typeof payload.e !== 'number'
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (payload.e * 1000 < now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, action: { userId: payload.u, reminderId: payload.r, dueDate: payload.d } };
}
