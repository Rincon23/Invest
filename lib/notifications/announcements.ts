/** One entry in the changelog notified through the bell (see `lib/server/announcements.ts`). */
export interface FeatureAnnouncement {
  /** Stable id, never reused or renamed once shipped: becomes the notification's `sourceKey`. */
  key: string;
  title: string;
  body: string;
  href?: string;
  /**
   * When this shipped (ISO instant). Only accounts created before it are notified — a brand-new
   * account starts already caught up, since everything in the app is new to it anyway.
   */
  publishedAt: string;
}

/**
 * Every user-visible feature the app has announced through the bell, oldest first. Whenever a
 * new module, screen or button ships that existing users should hear about, add an entry here —
 * `lib/server/announcements.ts` notifies every account created before `publishedAt`; anyone who
 * signs up afterwards never sees it, because their app was already born with it.
 */
export const FEATURE_ANNOUNCEMENTS: FeatureAnnouncement[] = [];
