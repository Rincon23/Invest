import { eq } from 'drizzle-orm';
import { isNotificationCategoryOn, type NotificationCategory, type PushMessage } from '../notifications/types';
import { budgetSettings, notifications } from './db/schema';
import type { Database } from './db/types';
import { sendPushToUser, type PushSender, type SendOptions } from './push';

export interface NotifyInput {
  category: NotificationCategory;
  message: PushMessage;
  /** Dedupe key: a second call with the same (userId, sourceKey) never records or pushes again. */
  sourceKey?: string;
}

/** Web Push payloads top out near 4 KB; a batch bigger than this goes in more than one push. */
const PUSH_PAYLOAD_BUDGET = 3000;

/**
 * Every notification the app generates goes through here: it is always logged to the in-app
 * bell (Central de notificações), and also pushed to the phone unless this account turned that
 * category off in Notificações. A push failure never rolls back the in-app record — the person
 * still finds it in the app even if the phone missed it. Returns whether it was newly recorded
 * (false when `sourceKey` had already been recorded for this user, so callers driving a batch —
 * e.g. one announcement to every account — can count how many were actually new).
 */
export async function sendUserNotification(
  db: Database,
  userId: string,
  input: NotifyInput,
  pushOptions?: SendOptions & { sender?: PushSender },
): Promise<boolean> {
  const [recorded] = await sendUserNotifications(db, userId, [input], pushOptions);
  return recorded;
}

/**
 * Several notifications due at the same moment: each is recorded on its own, but they reach the
 * phone in as few pushes as possible (the service worker shows each one separately). Pushes a
 * second apart can get lost on the phone. Returns, per input, whether it was newly recorded.
 */
export async function sendUserNotifications(
  db: Database,
  userId: string,
  inputs: NotifyInput[],
  pushOptions?: SendOptions & { sender?: PushSender },
): Promise<boolean[]> {
  const results: boolean[] = [];
  const toPush: NotifyInput[] = [];
  for (const input of inputs) {
    const recorded = await db
      .insert(notifications)
      .values({
        userId,
        category: input.category,
        title: input.message.title,
        body: input.message.body,
        href: input.message.url,
        sourceKey: input.sourceKey ?? null,
      })
      .onConflictDoNothing({ target: [notifications.userId, notifications.sourceKey] })
      .returning({ id: notifications.id });
    results.push(recorded.length > 0);
    if (recorded.length > 0) toPush.push(input);
  }
  if (toPush.length === 0) return results;

  const [settings] = await db
    .select({ notificationPrefs: budgetSettings.notificationPrefs })
    .from(budgetSettings)
    .where(eq(budgetSettings.userId, userId));
  const messages = toPush
    .filter((input) => isNotificationCategoryOn(settings?.notificationPrefs, input.category))
    .map((input) => input.message);
  for (const message of bundle(messages)) {
    await sendPushToUser(db, userId, message, pushOptions);
  }
  return results;
}

/** Packs messages into pushes: the first on top (what an older service worker shows), the rest in `more`. */
export function bundle(messages: PushMessage[]): PushMessage[] {
  const pushes: PushMessage[] = [];
  for (const message of messages) {
    const last = pushes[pushes.length - 1];
    if (last) {
      const more = [...(last.more ?? []), message];
      if (JSON.stringify({ ...last, more }).length <= PUSH_PAYLOAD_BUDGET) {
        last.more = more;
        continue;
      }
    }
    pushes.push({ ...message });
  }
  return pushes;
}
