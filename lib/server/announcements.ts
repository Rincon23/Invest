import { eq } from 'drizzle-orm';
import { hasRealName } from '../auth/names';
import type { FeatureAnnouncement } from '../notifications/announcements';
import { jobRuns, user } from './db/schema';
import type { Database } from './db/types';
import { sendUserNotification } from './notify';

const ANNOUNCEMENTS_JOB = 'announcements';
/** Announcements change rarely; checking once an hour is plenty and keeps this cheap. */
const ANNOUNCEMENTS_EVERY_MS = 60 * 60 * 1000;

/**
 * Notifies every account that existed before a feature shipped, so it hears about it once,
 * through the bell (and a push, unless "Novidades do app" is off). Accounts created after
 * `publishedAt` never get it — their app was already born with that feature, nothing about it
 * is news to them. Idempotent: each (user, announcement) pair is recorded once (see
 * `sendUserNotification`'s `sourceKey`), so running this again only catches new accounts or new
 * announcements — including when the person swiped the announcement away, since dismissing one
 * leaves the row behind (`dismissedAt`) precisely so this job does not send it all over again.
 */
export async function runAnnouncementsJob(
  db: Database,
  announcements: FeatureAnnouncement[],
  now: Date = new Date(),
): Promise<{ notified: number }> {
  if (announcements.length === 0) return { notified: 0 };
  const [row] = await db.select().from(jobRuns).where(eq(jobRuns.name, ANNOUNCEMENTS_JOB));
  if (row && now.getTime() - row.lastRunAt.getTime() < ANNOUNCEMENTS_EVERY_MS) return { notified: 0 };
  await db
    .insert(jobRuns)
    .values({ name: ANNOUNCEMENTS_JOB, lastRunAt: now })
    .onConflictDoUpdate({ target: jobRuns.name, set: { lastRunAt: now } });

  const accounts = await db.select({ id: user.id, createdAt: user.createdAt }).from(user);
  let notified = 0;
  for (const account of accounts) {
    for (const announcement of announcements) {
      if (account.createdAt >= new Date(announcement.publishedAt)) continue;
      const sent = await sendUserNotification(db, account.id, {
        category: 'feature',
        sourceKey: `feature:${announcement.key}`,
        message: {
          title: announcement.title,
          body: announcement.body,
          url: announcement.href ?? '/notificacoes',
        },
      });
      if (sent) notified += 1;
    }
  }
  return { notified };
}

const MISSING_NAME_JOB = 'missing-name';

/**
 * Asks, once, every account that still has no name of its own — the ones made before the sign-up
 * asked for it, which got the start of the e-mail instead — to write it in Configurações, so the
 * app (the greeting, the reminders) can call the person by the first name. Checked once an hour,
 * like the announcements; the `sourceKey` makes sure nobody is asked twice, even after swiping
 * the notice away.
 */
export async function runMissingNameJob(db: Database, now: Date = new Date()): Promise<{ notified: number }> {
  const [row] = await db.select().from(jobRuns).where(eq(jobRuns.name, MISSING_NAME_JOB));
  if (row && now.getTime() - row.lastRunAt.getTime() < ANNOUNCEMENTS_EVERY_MS) return { notified: 0 };
  await db
    .insert(jobRuns)
    .values({ name: MISSING_NAME_JOB, lastRunAt: now })
    .onConflictDoUpdate({ target: jobRuns.name, set: { lastRunAt: now } });

  const accounts = await db.select({ id: user.id, name: user.name, email: user.email }).from(user);
  let notified = 0;
  for (const account of accounts) {
    if (hasRealName(account.name, account.email)) continue;
    const sent = await sendUserNotification(db, account.id, {
      category: 'system',
      sourceKey: 'profile:missing-name',
      message: {
        title: '👋 Como podemos te chamar?',
        body: 'Coloque seu nome e sobrenome em Configurações: é ali que você muda o nome da conta. Assim os lembretes te chamam pelo nome.',
        url: '/configuracoes',
      },
    });
    if (sent) notified += 1;
  }
  return { notified };
}
