import { HttpError } from './httpError';

/**
 * How much one account can keep. Far above what a person registers by hand, low enough that a
 * script with one account can't fill the server's disk: the database lives on the same small
 * board as everything else. Editing something that already exists always goes through; only a
 * new one past the limit is refused.
 */
export const QUOTAS = {
  /** Categories, archived ones included (a category is never deleted). */
  topics: 60,
  months: 1200,
  incomesPerMonth: 1000,
  expensesPerMonth: 5000,
  cards: 20,
  recurring: 200,
  installments: 500,
  buckets: 50,
  reminders: 300,
  /** Diagrama: assets of every type together, questions of every type together, aportes kept. */
  diagramAssets: 300,
  diagramQuestions: 200,
  diagramContributions: 2000,
  /** Browsers receiving notifications; past it, the one unused the longest is dropped. */
  pushDevices: 10,
} as const;

/** Refuses a new item once the account already has `others` (without it) at the `limit`. */
export function checkQuota(others: number, limit: number, message: string): void {
  if (others >= limit) throw new HttpError(409, 'QUOTA_EXCEEDED', message);
}
