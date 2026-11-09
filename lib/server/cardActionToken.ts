import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The "Fatura paga ✅" button on a bill notification works without a session, exactly like the
 * reminders' "Realizado" (see `reminderActionToken.ts`): the service worker may run days after
 * the app was last opened. The button carries a token signed with ACTION_TOKEN_SECRET that
 * allows one single thing — marking this bill, of this card, for this person, as paid — and
 * only while the notice is still current.
 */
export const CARD_ACTION_TOKEN_TTL_MS = 36 * 60 * 60 * 1000;

export interface CardBillAction {
  userId: string;
  cardId: string;
  month: string;
}

interface Payload {
  u: string;
  c: string;
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
export function signCardBillAction(action: CardBillAction, now: Date = new Date()): string | null {
  const key = secret();
  if (!key) return null;
  const payload: Payload = {
    u: action.userId,
    c: action.cardId,
    m: action.month,
    e: Math.floor((now.getTime() + CARD_ACTION_TOKEN_TTL_MS) / 1000),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data, key)}`;
}

export type VerifyResult =
  | { ok: true; action: CardBillAction }
  | { ok: false; reason: 'invalid' | 'expired' };

export function verifyCardBillAction(token: string, now: Date = new Date()): VerifyResult {
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
    typeof payload.c !== 'string' ||
    typeof payload.m !== 'string' ||
    typeof payload.e !== 'number'
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (payload.e * 1000 < now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, action: { userId: payload.u, cardId: payload.c, month: payload.m } };
}
