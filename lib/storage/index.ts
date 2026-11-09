export * from './repository';
export * from './httpRepository';
export * from './notifications';
export * from './notificationsFeed';
export * from './banks';
export * from './diagram';
export * from './preferences';
export * from './exportImport';

import type { SettingsRepository } from './repository';
import { HttpSettingsRepository } from './httpRepository';
import { HttpNotificationsRepository, type NotificationsRepository } from './notifications';
import { HttpNotificationsFeedRepository, type NotificationsFeedRepository } from './notificationsFeed';
import { HttpBanksRepository, type BanksRepository } from './banks';
import { HttpDiagramRepository, type DiagramRepository } from './diagram';

/** Singleton repository used throughout the app: the app's own API (Postgres on the server, scoped to the signed-in user). */
export const settingsRepository: SettingsRepository = new HttpSettingsRepository();

/** The devices that receive this user's notifications. */
export const notificationsRepository: NotificationsRepository = new HttpNotificationsRepository();

/** The signed-in user's notification history (the bell / Central de notificações). */
export const notificationsFeedRepository: NotificationsFeedRepository = new HttpNotificationsFeedRepository();

/** Open Finance: the person's Pluggy key and the brokers they brought. */
export const banksRepository: BanksRepository = new HttpBanksRepository();

/** The Diagrama: targets per type, assets and their scores, aportes. */
export const diagramRepository: DiagramRepository = new HttpDiagramRepository();
