import { lt, sql } from 'drizzle-orm';
import { formatBRL } from '../budget/money';
import { recurringNoticeBody, recurringNoticeDays, type RecurringNoticeDay } from '../budget/recurring';
import { zonedInstant, zonedMoment } from '../reminders';
import { PostgresBudgetRepository } from './budgetRepository';
import { budgetSettings, recurringDeliveries } from './db/schema';
import type { Database } from './db/types';
import { catchUpFrom, markRun } from './jobRuns';
import { sendUserNotification } from './notify';
import type { PushSender } from './push';
import { signRecurringLaunch } from './recurringActionToken';
import { PostgresWalletRepository } from './walletRepository';

/**
 * The notices of "Contas do mês": on the day a bill falls due and, while it is not launched (and
 * the person wants it), once a day for a few days afterwards. The notice carries "Lançar ✅",
 * which launches the bill as it is without opening the app — except a parcelled one, which needs
 * the form. Same shape as the card bills job: a slot is recorded in `recurring_deliveries` before
 * it is sent, and only whoever records it sends it, so nothing is ever sent twice.
 */

export const RECURRING_BILLS_JOB = 'recurring-bills';
/** A bill notice is still worth receiving some hours late (the phone was off). */
const NOTICE_TTL_SECONDS = 12 * 60 * 60;
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface Notice extends RecurringNoticeDay {
  at: Date;
}

/** The notices of one user that fall in the window (`from`, `to`]. */
export function plannedRecurringNotices(
  days: RecurringNoticeDay[],
  notifyTime: string,
  from: Date,
  to: Date,
): Notice[] {
  return days
    .map((day) => ({ ...day, at: zonedInstant(day.date, notifyTime) }))
    .filter((notice) => notice.at > from && notice.at <= to)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
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
  const month = zonedMoment(now).date.slice(0, 7);
  const days = recurringNoticeDays(
    snapshot.recurring,
    snapshot.recurringLaunches,
    snapshot.recurringSettings,
    month,
  );
  const notices = plannedRecurringNotices(days, snapshot.recurringSettings.notifyTime, from, now);
  if (notices.length === 0) return 0;

  // A catch-up may find several notices of the same bill: only the latest one is worth sending.
  const latest = new Map<string, Notice>();
  for (const notice of notices) latest.set(`${notice.item.id}:${notice.month}`, notice);

  let sent = 0;
  for (const notice of latest.values()) {
    const recorded = await db
      .insert(recurringDeliveries)
      .values({ userId, recurringId: notice.item.id, month: notice.month, slotAt: notice.at })
      .onConflictDoNothing()
      .returning({ recurringId: recurringDeliveries.recurringId });
    if (recorded.length === 0) continue;

    // A parcelled bill is launched through the form (the first charge is chosen there).
    const parcelled = notice.item.card && Boolean(notice.item.installmentCount);
    const token = parcelled
      ? null
      : signRecurringLaunch({ userId, recurringId: notice.item.id, month: notice.month }, now);
    await sendUserNotification(
      db,
      userId,
      {
        category: 'recurring',
        message: {
          title: `🧾 ${notice.item.description}`,
          body: recurringNoticeBody(notice, formatBRL(notice.item.amount)),
          url: '/carteira/recorrentes',
          tag: `recurring:${notice.item.id}:${notice.month}`,
          ...(token
            ? {
                actions: [
                  {
                    action: 'launch',
                    title: 'Lançar ✅',
                    endpoint: '/api/v1/wallet/recurring/actions/launch',
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

/** Sends every bill notice due since the last run, for each user with "Contas do mês" on. */
export async function runRecurringBillsJob(
  db: Database,
  now: Date = new Date(),
  sender?: PushSender,
): Promise<{ notifications: number }> {
  const from = await catchUpFrom(db, RECURRING_BILLS_JOB, now);
  if (from >= now) return { notifications: 0 };

  // "Contas do mês" needs Lançamentos: without it a bill has nowhere to be launched.
  const users = await db
    .select({ userId: budgetSettings.userId })
    .from(budgetSettings)
    .where(
      sql`coalesce((${budgetSettings.modules}->>'recurring')::boolean, true) and coalesce((${budgetSettings.modules}->>'expenses')::boolean, true)`,
    );

  let notifications = 0;
  for (const { userId } of users) {
    try {
      notifications += await notifyUser(db, userId, from, now, sender);
    } catch (err) {
      console.error('[contas do mês] falha ao avisar um usuário:', err);
    }
  }

  await markRun(db, RECURRING_BILLS_JOB, now);
  await db
    .delete(recurringDeliveries)
    .where(lt(recurringDeliveries.slotAt, new Date(now.getTime() - DELIVERY_RETENTION_MS)));
  return { notifications };
}
