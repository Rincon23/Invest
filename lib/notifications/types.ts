/** What the service worker shows. Built on the server, sent encrypted through Web Push. */
export interface PushMessage {
  title: string;
  body: string;
  /** Page opened when the notification itself is tapped. */
  url: string;
  /**
   * Notifications with the same tag replace each other instead of piling up (the 12:00 reminder
   * replaces the 08:00 one).
   */
  tag?: string;
  /** Buttons under the notification (Android). iOS ignores them; the screen has the same action. */
  actions?: PushAction[];
  /**
   * Shown without sound or vibration ("Aviso silencioso" of Open Finance). An older service
   * worker ignores it and rings: that is fine.
   */
  silent?: boolean;
  /**
   * Other notifications due at the same moment, shown by the service worker from this same push.
   * Two pushes a second apart can reach the phone as one (Android kept only the first), so
   * whatever is due together travels together; each one is still its own notification.
   */
  more?: PushMessage[];
}

export interface PushAction {
  /** Identifier the service worker receives when this button is tapped. */
  action: string;
  title: string;
  /** Called (POST, JSON `body`) by the service worker, without opening the app. */
  endpoint: string;
  body?: Record<string, unknown>;
}

/** A device that receives this user's notifications, as listed in Settings. */
export interface PushDevice {
  id: string;
  /** The push service address; the browser compares it to its own to find "este aparelho". */
  endpoint: string;
  /** "Chrome no Android". */
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
}

/** The outcome of sending one message to a user's devices. */
export interface PushSendReport {
  /** Devices the push service accepted the message for. */
  sent: number;
  /** Subscriptions the push service said are gone (404/410), now deleted. */
  removed: number;
  /** Other failures (network, 5xx); the subscription is kept for the next try. */
  failed: number;
}

/** The browser's `PushSubscription.toJSON()`, as sent to the API. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The endpoint this one replaces, when the browser rotated the subscription. */
  previousEndpoint?: string;
}

// ---------------------------------------------------------------------------
// The in-app notification center (every notification the app ever generated,
// independent of whether push itself is on for this account or this device).
// ---------------------------------------------------------------------------

/**
 * What kind of thing generated a notification, so the bell can show an icon per row. `gmail` is
 * only for the old alerts of the retired Monitor de Gmail still in someone's history.
 */
export type NotificationCategory =
  | 'reminder'
  | 'card'
  | 'recurring'
  | 'gmail'
  | 'banks'
  | 'feature'
  | 'motivation'
  | 'system';

/** Label for each category in the notification-preferences switches. */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  reminder: 'Lembretes',
  card: 'Cartões',
  recurring: 'Contas do mês',
  gmail: 'Monitor de Gmail',
  banks: 'Open Finance',
  feature: 'Novidades do app',
  motivation: 'Frase da semana',
  system: 'Outros avisos',
};

/** One row of the in-app notification center. */
export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Whether `category` should push to this account's phone. Absent (or an unlisted category, such
 * as `system`) means on — only an explicit `false` turns a category off. The in-app bell always
 * gets every notification regardless of this; it only gates the push to the phone.
 */
export function isNotificationCategoryOn(
  prefs: Partial<Record<NotificationCategory, boolean>> | undefined,
  category: NotificationCategory,
): boolean {
  return prefs?.[category] !== false;
}
