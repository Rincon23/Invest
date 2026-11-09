import type { BudgetSettings, Expense, Income, Month, MonthData } from '../budget/types';
import type { DiagramBackup } from '../diagram/types';

/**
 * What a backup exported today declares. Version 2 added the modules and the "A receber"
 * category; version 3, the bottom bar and the dismissed notices; version 4, the tags.
 */
export const BACKUP_VERSION = 4;

export interface BackupPayload {
  /** Older versions are still accepted on import: they simply lack the newer fields. */
  version: 1 | 2 | 3 | 4;
  exportedAt: string;
  settings: BudgetSettings;
  months: MonthData[];
  /** The Diagrama. Absent in backups from before it existed: importing one leaves it as it is. */
  diagram?: DiagramBackup;
}

/** Thrown when a write targets a month that has been closed. Message is user-facing (pt-BR). */
export class MonthClosedError extends Error {
  constructor(month: Month) {
    super(`O mês ${month} está fechado. Reabra-o para editar.`);
    this.name = 'MonthClosedError';
  }
}

/** Thrown when an operation references a month that does not exist yet. */
export class MonthNotFoundError extends Error {
  constructor(month: Month) {
    super(`O mês ${month} não foi encontrado.`);
    this.name = 'MonthNotFoundError';
  }
}

/** Thrown by cloud-backed repositories when there is no signed-in user. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('Sessão expirada. Entre novamente para continuar.');
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Storage-agnostic interface for all budget data access. The UI and the
 * pure calculation modules never talk to the API, IndexedDB or the database
 * directly — they only depend on this contract. In the browser it is
 * `HttpBudgetRepository` (the app's own API); on the server,
 * `PostgresBudgetRepository`; `IndexedDbBudgetRepository` remains only to
 * import a device's old local data.
 */
export interface BudgetRepository {
  getSettings(): Promise<BudgetSettings>;
  saveSettings(settings: BudgetSettings): Promise<void>;
  /** Marks this account as having finished (or skipped) the new-user wizard/tour, for good. */
  completeOnboarding(): Promise<void>;

  listMonths(): Promise<Month[]>;
  getMonth(month: Month): Promise<MonthData | undefined>;
  /**
   * Returns the month's data if it already exists, otherwise a computed preview
   * (with rollover carryIn from the latest prior month) that is NOT persisted.
   * Used when merely navigating to a month, so browsing the calendar never
   * litters storage with empty months.
   */
  peekMonth(month: Month): Promise<MonthData>;
  /** Returns the month's data, creating and persisting it (with rollover carryIn from the latest prior month) if it doesn't exist yet. */
  ensureMonth(month: Month): Promise<MonthData>;

  saveIncome(month: Month, income: Income): Promise<void>;
  deleteIncome(month: Month, incomeId: string): Promise<void>;

  saveExpense(month: Month, expense: Expense): Promise<void>;
  deleteExpense(month: Month, expenseId: string): Promise<void>;

  /**
   * Freezes the month. With `openNext`, the following month is created in the same
   * transaction, already carrying each category's leftover (what "Fechar mês" does). With
   * `dropLeftovers` the leftovers stay behind: the month after it starts with no carryIn.
   */
  closeMonth(month: Month, openNext?: boolean, dropLeftovers?: boolean): Promise<void>;
  /** Reopens a closed month and recomputes carryIn for every later month that already exists. */
  reopenMonth(month: Month): Promise<void>;
  /** Permanently deletes a stored month and recomputes carryIn for every later month. No-op if the month was never persisted. */
  deleteMonth(month: Month): Promise<void>;

  exportData(): Promise<BackupPayload>;
  importData(payload: BackupPayload): Promise<void>;
  clearAll(): Promise<void>;
}
