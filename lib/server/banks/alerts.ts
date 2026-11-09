import 'server-only';
import {
  connectionHealth,
  consentDaysLeft,
  formatAgo,
  reviewAlertBody,
  reviewAlertUrl,
  reviewMonths,
  type BankConnection,
  type ReviewNews,
} from '@/lib/banks';
import { isModuleOn } from '@/lib/modules';
import { zonedMoment } from '@/lib/reminders/time';
import { PostgresBudgetRepository } from '../budgetRepository';
import type { Database } from '../db/types';
import { sendUserNotifications, type NotifyInput } from '../notify';
import type { PushSender } from '../push';
import { PostgresWalletRepository } from '../walletRepository';
import type { FetchLike } from './pluggy';
import { PostgresBanksRepository } from './repository';
import { buildReview } from './review';
import { syncUser, type BankSyncResult } from './service';

/**
 * Open Finance on the phone (category "Open Finance"): after a read that brought something to
 * check, one alert per bank ("🏦 Nubank atualizou: 3 gastos e 1 recebimento para conferir."),
 * and — once each — a bank that stopped and an authorization about to run out. Every alert has a
 * `sourceKey`, so nothing is ever told twice, and all of them follow "Aviso silencioso".
 */

/** An alert about money is still worth reading some hours late. */
const ALERT_TTL_SECONDS = 12 * 60 * 60;
/** Where a tap goes: the bank screen; what arrived goes to its review ("Confira os gastos"). */
export const BANKS_ALERT_URL = '/bancos';
export const BANKS_REVIEW_URL = '/bancos/conferir';

export interface AlertDeps {
  sender?: PushSender;
}

/**
 * What each bank brought in this read that asks for a tap, as alerts (not sent): only what is new
 * in this read and fell in "Falta no Capital" this month or the last, counted by the very
 * `buildReview` of the screen, so the alert never disagrees with it. The first read (a year of
 * history, with the person on the screen) tells nothing.
 */
export async function arrivalAlerts(
  db: Database,
  userId: string,
  repo: PostgresBanksRepository,
  results: BankSyncResult[],
  now: Date,
): Promise<NotifyInput[]> {
  const fresh = results.filter((result) => result.changed && !result.firstRead && result.added.length > 0);
  if (fresh.length === 0) return [];
  const settings = await repo.alertSettings();
  if (!settings.expenses && !settings.incomes) return [];
  const budget = new PostgresBudgetRepository(db, userId);
  // The check launches into Lançamentos: without it there is nothing to check.
  if (!isModuleOn(await budget.getSettings(), 'expenses')) return [];
  const wallet = new PostgresWalletRepository(db, userId, budget);
  const today = zonedMoment(now).date;
  const months = reviewMonths(today);
  const reviews = [];
  for (const month of months) reviews.push(await buildReview({ banks: repo, repo: budget, wallet }, { month, today }));

  const names = await repo.connectionNames();
  const alerts: NotifyInput[] = [];
  for (const result of fresh) {
    const added = new Set(result.added);
    const isNew = (ids: string[]) => ids.some((id) => added.has(id));
    const news: ReviewNews[] = reviews.map((review) => ({
      month: review.month,
      expenses: review.expenses.missing.filter((item) => isNew(item.transactionIds)).length,
      incomes: review.incomes.missing.filter((item) => isNew(item.transactionIds)).length,
    }));
    const body = reviewAlertBody(news, settings);
    if (!body) continue;
    const bank = names.get(result.itemId) ?? 'Banco';
    alerts.push({
      category: 'banks',
      // One alert per read of this bank: the first new transaction stands for the batch.
      sourceKey: `banks-arrivals:${result.itemId}:${[...result.added].sort()[0]}`,
      message: {
        title: `🏦 ${bank} atualizou`,
        body,
        url: reviewAlertUrl(BANKS_REVIEW_URL, news, settings, months[months.length - 1]),
        tag: `banks-arrivals-${result.itemId}`,
        silent: settings.silent,
      },
    });
  }
  return alerts;
}

/**
 * A bank that went quiet (48 h without data) and an authorization 15 days from running out: told
 * once per episode (the key carries the date that would change when it is over).
 */
export function healthAlerts(connections: BankConnection[], now: number, silent = false): NotifyInput[] {
  const alerts: NotifyInput[] = [];
  for (const connection of connections) {
    if (connectionHealth(connection, now) === 'stale' && connection.lastUpdatedAt) {
      alerts.push({
        category: 'banks',
        sourceKey: `banks-stale:${connection.itemId}:${connection.lastUpdatedAt}`,
        message: {
          title: `🏦 ${connection.name} parou`,
          body: `Nenhum dado novo do banco ${formatAgo(connection.lastUpdatedAt, now)}. Toque para reconectar no Meu Pluggy.`,
          url: BANKS_ALERT_URL,
          tag: `banks-stale-${connection.itemId}`,
          silent,
        },
      });
    }
    const days = connection.status === 'reconnect' ? null : consentDaysLeft(connection, now);
    if (days !== null && connection.consentExpiresAt) {
      alerts.push({
        category: 'banks',
        sourceKey: `banks-consent:${connection.itemId}:${connection.consentExpiresAt}`,
        message: {
          title: `🏦 ${connection.name}: autorização vencendo`,
          body:
            days === 0
              ? 'A autorização vence hoje. Toque para renovar.'
              : `A autorização vence em ${days} ${days === 1 ? 'dia' : 'dias'}. Toque para renovar.`,
          url: BANKS_ALERT_URL,
          tag: `banks-consent-${connection.itemId}`,
          silent,
        },
      });
    }
  }
  return alerts;
}

/**
 * One person's read (the hourly job and "Buscar novidades"), then what it tells them. Null when a
 * read of this person was already running.
 */
export async function syncAndNotify(
  db: Database,
  userId: string,
  fetchImpl: FetchLike = fetch,
  now = new Date(),
  deps: AlertDeps = {},
): Promise<BankSyncResult[] | null> {
  const repo = new PostgresBanksRepository(db, userId);
  const results = await syncUser(repo, userId, fetchImpl, now);
  if (results === null) return null;
  try {
    const alerts = [
      ...(await arrivalAlerts(db, userId, repo, results, now)),
      ...healthAlerts(await repo.listConnections(), now.getTime(), (await repo.alertSettings()).silent),
    ];
    if (alerts.length > 0) {
      await sendUserNotifications(db, userId, alerts, {
        sender: deps.sender,
        ttlSeconds: ALERT_TTL_SECONDS,
        urgency: 'normal',
      });
    }
  } catch (err) {
    console.error('[bancos] falha ao avisar:', err instanceof Error ? err.message : err);
  }
  return results;
}
