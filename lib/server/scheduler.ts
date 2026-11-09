import { eq, exists, gt, lt, or, sql } from 'drizzle-orm';
import { firstName, realName } from '../auth/names';
import { FEATURE_ANNOUNCEMENTS } from '../notifications/announcements';
import { notificationSlots, planNotifications, weekdayOf, zonedMoment } from '../reminders';
import { runAnnouncementsJob, runMissingNameJob } from './announcements';
import { runCardBillsJob } from './cardBills';
import { runRecurringBillsJob } from './recurringBills';
import {
  budgetSettings,
  investmentBuckets,
  investmentReserves,
  priceCache,
  reminderDeliveries,
  user,
} from './db/schema';
import type { Database } from './db/types';
import { catchUpFrom, lastRun, markRun } from './jobRuns';
import { runBanksJob } from './banks/job';
import { runMotivationJob } from './motivation';
import { sendUserNotifications, type NotifyInput } from './notify';
import type { PushSender } from './push';
import { fetchQuotes } from './quotes';
import { signReminderAction } from './reminderActionToken';
import { PostgresRemindersRepository } from './remindersRepository';

/**
 * The background jobs, run inside the Capital server itself (no n8n, no extra container): once a
 * minute, a little after the minute turns. Every job remembers when it last ran (`job_runs`), so
 * after a restart it catches up on what it missed instead of skipping it.
 */

const REMINDERS_JOB = 'reminders';
const QUOTES_JOB = 'quotes';
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** A reminder is still worth receiving a few hours late (the phone was off, for instance). */
const REMINDER_TTL_SECONDS = 6 * 60 * 60;

/**
 * Sends every reminder notification due since the last run, for each user with the Lembretes
 * module on — with or without a device registered for push: it is always recorded in the
 * Central de notificações either way, and also pushed to a device when there is one. A slot is
 * recorded in `reminder_deliveries` before it is sent, and only whoever records it sends it —
 * running this twice never notifies twice.
 */
export async function runRemindersJob(
  db: Database,
  now: Date = new Date(),
  sender?: PushSender,
): Promise<{ notifications: number }> {
  const from = await catchUpFrom(db, REMINDERS_JOB, now);
  if (from >= now) return { notifications: 0 };

  const users = await db
    .select({ userId: budgetSettings.userId })
    .from(budgetSettings)
    .where(sql`coalesce((${budgetSettings.modules}->>'reminders')::boolean, true)`);

  let notifications = 0;
  for (const { userId } of users) {
    try {
      notifications += await notifyUser(db, userId, from, now, sender);
    } catch (err) {
      console.error('[lembretes] falha ao notificar um usuário:', err);
    }
  }

  await markRun(db, REMINDERS_JOB, now);
  await db
    .delete(reminderDeliveries)
    .where(lt(reminderDeliveries.slotAt, new Date(now.getTime() - DELIVERY_RETENTION_MS)));
  return { notifications };
}

async function notifyUser(
  db: Database,
  userId: string,
  from: Date,
  now: Date,
  sender?: PushSender,
): Promise<number> {
  const schedule = await new PostgresRemindersRepository(db, userId).loadSchedule(now);
  const slots = notificationSlots(schedule, from, now);
  if (slots.length === 0) return 0;

  // The reminders call the person by the first name, when the account has a real one.
  const [account] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  const name = firstName(realName(account?.name, account?.email));

  const due: NotifyInput[] = [];
  for (const note of planNotifications(slots, schedule.reminders, name)) {
    const recorded = await db
      .insert(reminderDeliveries)
      .values(note.slots.map((slot) => ({ userId, reminderId: slot.reminderId, slotAt: slot.at })))
      .onConflictDoNothing()
      .returning({ reminderId: reminderDeliveries.reminderId });
    if (recorded.length === 0) continue;

    const token = note.done ? signReminderAction({ userId, ...note.done }, now) : null;
    due.push({
      category: 'reminder',
      message: {
        title: note.title,
        body: note.body,
        url: note.url,
        tag: note.tag,
        ...(token
          ? {
              actions: [
                {
                  action: 'done',
                  title: 'Realizado ✅',
                  endpoint: '/api/v1/reminders/actions/done',
                  body: { token },
                },
              ],
            }
          : {}),
      },
    });
  }
  if (due.length === 0) return 0;

  // Everything due in this minute goes out together: the phone showed only one of two pushes
  // sent a second apart (a weekly reminder and the daily tasks, both at 08:00).
  await sendUserNotifications(db, userId, due, {
    sender,
    ttlSeconds: REMINDER_TTL_SECONDS,
    urgency: 'high',
  });
  return due.length;
}

/** B3's session, with a margin: weekdays from 10:00 to 18:30 in São Paulo. */
function isMarketOpen(now: Date): boolean {
  const { date, minutes } = zonedMoment(now);
  const weekday = weekdayOf(date);
  return weekday >= 1 && weekday <= 5 && minutes >= 10 * 60 && minutes <= 18 * 60 + 30;
}

const QUOTES_EVERY_MS = 30 * 60 * 1000;

/**
 * Every 30 minutes while the market is open, refreshes the price of every ticker someone holds,
 * so the Carteira opens with a recent price. Free sources (B3, then Yahoo), all tickers at once.
 */
export async function runQuotesJob(db: Database, now: Date = new Date()): Promise<{ updated: number }> {
  if (!isMarketOpen(now)) return { updated: 0 };
  const previous = await lastRun(db, QUOTES_JOB);
  if (previous && now.getTime() - previous.getTime() < QUOTES_EVERY_MS) return { updated: 0 };
  await markRun(db, QUOTES_JOB, now);

  const held = await db
    .selectDistinct({ ticker: investmentReserves.ticker })
    .from(investmentReserves)
    .where(
      or(
        gt(investmentReserves.totalQuotas, 0),
        exists(
          db
            .select({ one: sql`1` })
            .from(investmentBuckets)
            .where(eq(investmentBuckets.userId, investmentReserves.userId)),
        ),
      ),
    );
  if (held.length === 0) return { updated: 0 };

  const quotes = await fetchQuotes(held.map((row) => row.ticker));
  for (const quote of quotes.values()) {
    const values = { price: quote.price, name: quote.name ?? null, source: quote.source, fetchedAt: now };
    await db
      .insert(priceCache)
      .values({ ticker: quote.ticker, ...values })
      .onConflictDoUpdate({ target: priceCache.ticker, set: values });
  }
  return { updated: quotes.size };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

const globalForScheduler = globalThis as unknown as { capitalSchedulerStarted?: boolean };

/** Whether this server process runs the background jobs (the automatic tests check they keep up). */
export function schedulerRunning(): boolean {
  return globalForScheduler.capitalSchedulerStarted === true;
}

/** Seconds past the minute the jobs run at, so a slot at 08:00 goes out at 08:00:05. */
const TICK_OFFSET_MS = 5_000;

/**
 * Starts the minute loop once per server process (dev hot reloads included). Set SCHEDULER=off
 * in the environment to run a server without background jobs.
 */
export function startScheduler(getDb: () => Database): void {
  if (globalForScheduler.capitalSchedulerStarted || process.env.SCHEDULER === 'off') return;
  globalForScheduler.capitalSchedulerStarted = true;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const db = getDb();
      await runRemindersJob(db);
      await runCardBillsJob(db).catch((err) => console.error('[cartões] falha nos avisos:', err));
      await runRecurringBillsJob(db).catch((err) => console.error('[contas do mês] falha nos avisos:', err));
      await runQuotesJob(db).catch((err) => console.error('[cotações] falha na atualização:', err));
      await runBanksJob(db).catch((err) => console.error('[bancos] falha na leitura:', err));
      await runAnnouncementsJob(db, FEATURE_ANNOUNCEMENTS).catch((err) =>
        console.error('[novidades] falha ao notificar:', err),
      );
      await runMissingNameJob(db).catch((err) => console.error('[nome] falha ao avisar:', err));
      await runMotivationJob(db).catch((err) => console.error('[frase da semana] falha:', err));
    } catch (err) {
      console.error('[agenda] falha na rodada:', err);
    } finally {
      running = false;
    }
  };

  const scheduleNext = () => {
    const delay = 60_000 - (Date.now() % 60_000) + TICK_OFFSET_MS;
    setTimeout(() => {
      void tick();
      scheduleNext();
    }, delay).unref?.();
  };
  scheduleNext();
  console.log('[agenda] lembretes, cartões, cotações e bancos em segundo plano ativados.');
}
