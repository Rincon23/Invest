export * from './repository';
export * from './wallet';
export * from './indexedDbRepository';
export * from './httpRepository';
export * from './walletHttpRepository';
export * from './notifications';
export * from './notificationsFeed';
export * from './monthClosing';
export * from './newExpenses';
export * from './reimbursables';
export * from './tags';
export * from './reminders';
export * from './banks';
export * from './diagram';
export * from './preferences';
export * from './exportImport';

import type { BudgetRepository } from './repository';
import { HttpBudgetRepository } from './httpRepository';
import type { WalletRepository } from './wallet';
import { HttpWalletRepository } from './walletHttpRepository';
import { HttpNotificationsRepository, type NotificationsRepository } from './notifications';
import { HttpNotificationsFeedRepository, type NotificationsFeedRepository } from './notificationsFeed';
import { HttpRemindersRepository, type RemindersRepository } from './reminders';
import { HttpBanksRepository, type BanksRepository } from './banks';
import { HttpDiagramRepository, type DiagramRepository } from './diagram';

/**
 * Singleton repository used throughout the app: the app's own API (Postgres on the server,
 * scoped to the signed-in user). `IndexedDbBudgetRepository` is still exported for the
 * one-time migration of a device's old local data (see `lib/storage/localMigration.ts`).
 */
export const budgetRepository: BudgetRepository = new HttpBudgetRepository();

/** Same idea for the Carteira (gastos recorrentes, parcelados, reserva investida e caixa). */
export const walletRepository: WalletRepository = new HttpWalletRepository();

/** The devices that receive this user's notifications. */
export const notificationsRepository: NotificationsRepository = new HttpNotificationsRepository();

/** The signed-in user's notification history (the bell / Central de notificações). */
export const notificationsFeedRepository: NotificationsFeedRepository = new HttpNotificationsFeedRepository();

/** Lembretes and daily tasks. */
export const remindersRepository: RemindersRepository = new HttpRemindersRepository();

/** Open Finance: the person's Pluggy key and the banks they brought. */
export const banksRepository: BanksRepository = new HttpBanksRepository();

/** The Diagrama: targets per type, assets and their scores, aportes. */
export const diagramRepository: DiagramRepository = new HttpDiagramRepository();
