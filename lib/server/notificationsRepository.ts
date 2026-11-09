import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { AppNotification } from '../notifications/types';
import { notifications } from './db/schema';
import type { Database } from './db/types';

const LIST_LIMIT = 100;

/** What the bell and the Notificações screen need: the recent history and the unread count. */
export interface NotificationsSnapshot {
  notifications: AppNotification[];
  unread: number;
}

/** The signed-in user's notification history: what the bell and the Notificações screen read. */
export class PostgresNotificationsRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {}

  /** Everything this account still keeps in the bell — dismissed rows are history, not inbox. */
  private get visible() {
    return and(eq(notifications.userId, this.userId), isNull(notifications.dismissedAt));
  }

  async list(): Promise<NotificationsSnapshot> {
    const [rows, [{ unread }]] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(this.visible)
        .orderBy(desc(notifications.createdAt))
        .limit(LIST_LIMIT),
      this.db
        .select({ unread: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(this.visible, isNull(notifications.readAt))),
    ]);
    return { notifications: rows.map(toNotification), unread };
  }

  async markRead(id: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, this.userId), eq(notifications.id, id)));
  }

  async markAllRead(): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(this.visible, isNull(notifications.readAt)));
  }

  /**
   * The swipe-to-dismiss gesture. One a background job could produce again (it has a
   * `sourceKey`) is only hidden: the row has to stay, or the unique index it is deduped by
   * stops seeing it and the next run of that job sends the very same notification once more.
   * Anything else — a reminder — nothing will recreate, so it really goes.
   */
  async remove(id: string): Promise<void> {
    const mine = and(eq(notifications.userId, this.userId), eq(notifications.id, id));
    const hidden = await this.db
      .update(notifications)
      .set({ dismissedAt: new Date() })
      .where(and(mine, isNotNull(notifications.sourceKey)))
      .returning({ id: notifications.id });
    if (hidden.length === 0) await this.db.delete(notifications).where(mine);
  }

  /** "Limpar": the same as swiping every notification away, at once (see `remove`). */
  async removeAll(): Promise<void> {
    await this.db
      .update(notifications)
      .set({ dismissedAt: new Date() })
      .where(and(this.visible, isNotNull(notifications.sourceKey)));
    await this.db.delete(notifications).where(and(this.visible, isNull(notifications.sourceKey)));
  }
}

function toNotification(row: typeof notifications.$inferSelect): AppNotification {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
