import type { AppNotification } from '../notifications/types';
import { apiRequest, seg } from './apiClient';

/** What the bell and the Notificações screen need, in one read. */
export interface NotificationsSnapshot {
  notifications: AppNotification[];
  unread: number;
}

/** The signed-in user's notification history (the bell / Central de notificações). */
export interface NotificationsFeedRepository {
  list(): Promise<NotificationsSnapshot>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<void>;
}

export class HttpNotificationsFeedRepository implements NotificationsFeedRepository {
  list(): Promise<NotificationsSnapshot> {
    return apiRequest('GET', '/notifications');
  }

  markRead(id: string): Promise<void> {
    return apiRequest('POST', `/notifications/${seg(id)}/read`);
  }

  markAllRead(): Promise<void> {
    return apiRequest('POST', '/notifications/read-all');
  }

  remove(id: string): Promise<void> {
    return apiRequest('DELETE', `/notifications/${seg(id)}`);
  }

  removeAll(): Promise<void> {
    return apiRequest('DELETE', '/notifications');
  }
}
