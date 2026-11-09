import { eq, exists, sql } from 'drizzle-orm';
import { factOfWeek } from '../motivation';
import { isNotificationCategoryOn } from '../notifications/types';
import { weekdayOf, zonedMoment } from '../reminders';
import { budgetSettings, pushSubscriptions, user } from './db/schema';
import type { Database } from './db/types';
import { listFacts } from './factsRepository';
import { lastRun, markRun } from './jobRuns';
import { sendUserNotification } from './notify';
import type { PushSender } from './push';

export const MOTIVATION_JOB = 'motivation';

/** Monday (see `weekdayOf`), at 09:00 in São Paulo. */
const SEND_WEEKDAY = 1;
const SEND_FROM_MINUTES = 9 * 60;
/** After a server outage it still goes out the same day, but never at night. */
const SEND_UNTIL_MINUTES = 21 * 60;
/** Stale after a day: next week brings another one. */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * The "Você sabia?" of the week, on the phone (`lib/motivation`): the same fact for everyone. Only
 * for accounts with a device and with "Frase da semana" on — unlike the other notifications, nothing
 * goes to the bell otherwise: the Missões bar already shows a fact, and a person who turned this off
 * does not want it anywhere. The `sourceKey` keeps a run cut short from notifying anyone twice.
 */
export async function runMotivationJob(
  db: Database,
  now: Date = new Date(),
  sender?: PushSender,
): Promise<{ notified: number }> {
  const { date, minutes } = zonedMoment(now);
  if (weekdayOf(date) !== SEND_WEEKDAY) return { notified: 0 };
  if (minutes < SEND_FROM_MINUTES || minutes >= SEND_UNTIL_MINUTES) return { notified: 0 };
  const previous = await lastRun(db, MOTIVATION_JOB);
  if (previous && zonedMoment(previous).date === date) return { notified: 0 };

  const accounts = await db
    .select({ id: user.id, prefs: budgetSettings.notificationPrefs })
    .from(user)
    .leftJoin(budgetSettings, eq(budgetSettings.userId, user.id))
    .where(
      exists(
        db
          .select({ one: sql`1` })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, user.id)),
      ),
    );

  const fact = factOfWeek(await listFacts(db), date);
  let notified = 0;
  for (const account of accounts) {
    if (!isNotificationCategoryOn(account.prefs ?? undefined, 'motivation')) continue;
    try {
      const sent = await sendUserNotification(
        db,
        account.id,
        {
          category: 'motivation',
          sourceKey: `motivation:${date}`,
          message: { title: '💡 Você sabia?', body: fact.text, url: '/', tag: 'capital-frase' },
        },
        { sender, ttlSeconds: TTL_SECONDS, urgency: 'normal' },
      );
      if (sent) notified += 1;
    } catch (err) {
      console.error('[frase da semana] falha ao notificar um usuário:', err);
    }
  }

  await markRun(db, MOTIVATION_JOB, now);
  return { notified };
}
