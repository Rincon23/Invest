import { lt, sql } from 'drizzle-orm';
import {
  billNoticeDays,
  daysBetween,
  formatDayMonth,
  isUnassignedCard,
  type CardBill,
} from '../budget/cards';
import { formatBRL } from '../budget/money';
import type { CardSettings, CreditCard } from '../budget/types';
import { zonedInstant, zonedMoment } from '../reminders';
import { PostgresBudgetRepository } from './budgetRepository';
import { signCardBillAction } from './cardActionToken';
import { budgetSettings, cardBillDeliveries } from './db/schema';
import type { Database } from './db/types';
import { catchUpFrom, markRun } from './jobRuns';
import { sendUserNotification } from './notify';
import type { PushSender } from './push';
import { PostgresWalletRepository } from './walletRepository';

/**
 * The bill notices of the Cartão module: the notice before the due date, the one on the day
 * itself and, while the person does not tap "Fatura paga", one a day for a week afterwards —
 * which matters here, because no bill ever leaves the debt on its own. The "Não informado"
 * bill has no due date, so there is nothing to warn about: it never notifies.
 *
 * Same shape as the reminders job (`lib/server/scheduler.ts`): a slot is recorded in
 * `card_bill_deliveries` before it is sent, and only whoever records it sends it, so running
 * this twice never notifies twice.
 */

export const CARD_BILLS_JOB = 'card-bills';
/** A bill notice is still worth receiving some hours late (the phone was off). */
const NOTICE_TTL_SECONDS = 12 * 60 * 60;
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type NoticeKind = 'advance' | 'due' | 'late';

interface Notice {
  bill: CardBill;
  card: CreditCard;
  kind: NoticeKind;
  at: Date;
}

/** Every notice of one user that falls in the window (`from`, `to`]. */
export function plannedNotices(
  cards: CreditCard[],
  bills: CardBill[],
  settings: CardSettings,
  from: Date,
  to: Date,
): Notice[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const notices: Notice[] = [];

  for (const bill of bills) {
    if (bill.paid || bill.future || isUnassignedCard(bill.cardId)) continue;
    const card = byId.get(bill.cardId);
    if (!card || !card.notifyEnabled) continue;

    const days = billNoticeDays(card, bill.month, settings);
    const slots: { kind: NoticeKind; date: string }[] = [
      ...(days.advance ? [{ kind: 'advance' as const, date: days.advance }] : []),
      { kind: 'due', date: days.due },
      ...days.late.map((date) => ({ kind: 'late' as const, date })),
    ];

    for (const slot of slots) {
      const at = zonedInstant(slot.date, settings.notifyTime);
      if (at > from && at <= to) notices.push({ bill, card, kind: slot.kind, at });
    }
  }

  return notices.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function noticeBody(notice: Notice, today: string): string {
  const amount = formatBRL(notice.bill.total);
  const due = notice.bill.dueDate ?? today;
  const postponed = notice.bill.postponedFrom
    ? ` Caiu num fim de semana, então o pagamento é no dia ${formatDayMonth(due)}.`
    : '';
  if (notice.kind === 'due') return `Vence hoje: ${amount}.${postponed}`;
  if (notice.kind === 'advance') {
    const left = daysBetween(today, due);
    const when = left <= 1 ? 'amanhã' : `em ${left} dias`;
    return `Vence ${when}, dia ${formatDayMonth(due)}: ${amount}.${postponed}`;
  }
  const late = Math.max(1, -daysBetween(today, due));
  const since = late === 1 ? 'há 1 dia' : `há ${late} dias`;
  return `Atrasada ${since} (venceu em ${formatDayMonth(due)}): ${amount}. Toque em Fatura paga quando pagar.`;
}

async function notifyUser(
  db: Database,
  userId: string,
  from: Date,
  now: Date,
  sender?: PushSender,
): Promise<number> {
  const wallet = new PostgresWalletRepository(db, userId, new PostgresBudgetRepository(db, userId));
  const snapshot = await wallet.getSnapshot();
  const notices = plannedNotices(snapshot.cards, snapshot.bills, snapshot.cardSettings, from, now);
  if (notices.length === 0) return 0;

  // A catch-up may find several notices of the same bill: only the latest one is worth sending.
  const latest = new Map<string, Notice>();
  for (const notice of notices) latest.set(`${notice.bill.cardId}:${notice.bill.month}`, notice);

  let sent = 0;
  for (const notice of latest.values()) {
    const cardId = notice.bill.cardId;
    const recorded = await db
      .insert(cardBillDeliveries)
      .values({ userId, cardId, month: notice.bill.month, slotAt: notice.at })
      .onConflictDoNothing()
      .returning({ cardId: cardBillDeliveries.cardId });
    if (recorded.length === 0) continue;

    const token = signCardBillAction({ userId, cardId, month: notice.bill.month }, now);
    await sendUserNotification(
      db,
      userId,
      {
        category: 'card',
        message: {
          title: `💳 Fatura do ${notice.card.name}`,
          body: noticeBody(notice, zonedMoment(now).date),
          url: '/cartao',
          tag: `card-bill:${cardId}:${notice.bill.month}`,
          ...(token
            ? {
                actions: [
                  {
                    action: 'pay',
                    title: 'Fatura paga ✅',
                    endpoint: '/api/v1/wallet/cards/actions/pay',
                    body: { token },
                  },
                ],
              }
            : {}),
        },
      },
      { sender, ttlSeconds: NOTICE_TTL_SECONDS, urgency: 'high' },
    );
    sent += 1;
  }
  return sent;
}

/** Sends every bill notice due since the last run, for each user with the Cartão module on. */
export async function runCardBillsJob(
  db: Database,
  now: Date = new Date(),
  sender?: PushSender,
): Promise<{ notifications: number }> {
  const from = await catchUpFrom(db, CARD_BILLS_JOB, now);
  if (from >= now) return { notifications: 0 };

  const users = await db
    .select({ userId: budgetSettings.userId })
    .from(budgetSettings)
    .where(sql`coalesce((${budgetSettings.modules}->>'card')::boolean, true)`);

  let notifications = 0;
  for (const { userId } of users) {
    try {
      notifications += await notifyUser(db, userId, from, now, sender);
    } catch (err) {
      console.error('[cartões] falha ao avisar um usuário:', err);
    }
  }

  await markRun(db, CARD_BILLS_JOB, now);
  await db
    .delete(cardBillDeliveries)
    .where(lt(cardBillDeliveries.slotAt, new Date(now.getTime() - DELIVERY_RETENTION_MS)));
  return { notifications };
}
