import type { BankAlertSettings } from '../banks/alerts';
import type { BankHoldings } from '../banks/holdings';
import type { BankReview, BankReviewCounts } from '../banks/review';
import type { BankReserve, BanksOverview } from '../banks/types';
import type { Expense, Income, InstallmentPlan, Month } from '../budget/types';
import { apiRequest, seg } from './apiClient';

/** One decision about one line of the month's check (see app/api/v1/banks/review). */
export type BankReviewAction =
  | { action: 'expense'; transactionIds: string[]; month: Month; expense: Expense }
  | {
      action: 'plan';
      transactionIds: string[];
      plan: InstallmentPlan;
      /** "Trocar por parcelado": the expense entered "à vista" that the plan replaces. */
      replaces?: { month: Month; entryId: string };
    }
  | { action: 'income'; transactionIds: string[]; month: Month; income: Income }
  | { action: 'linked'; transactionIds: string[]; month: Month; entryId: string }
  | { action: 'reimbursed'; transactionIds: string[]; month: Month; expenseId: string }
  | { action: 'ignore'; transactionIds: string[] }
  | { action: 'restore'; transactionIds: string[] }
  | { action: 'link'; transactionIds: string[]; entries: { month: Month; entryId: string }[] }
  | { action: 'unlink'; transactionIds: string[] }
  | {
      action: 'card';
      transactionIds: string[];
      entry: 'expense' | 'plan';
      month: Month | null;
      entryId: string;
      cardId: string | null;
    }
  | { action: 'bill'; transactionIds: string[] };

export interface BankAlertsView {
  settings: BankAlertSettings;
}

/** What the gear sends: the switches. */
export type BankAlertChoices = BankAlertSettings;

export interface BanksOverviewResult extends BanksOverview {
  /** Banks whose authorization was never finished and that were taken out on this read. */
  givenUp: number;
}

/** Like `BudgetRepository`: the Open Finance screen only talks to this contract. */
export interface BanksRepository {
  getOverview(): Promise<BanksOverviewResult>;
  saveKey(clientId: string, clientSecret: string): Promise<void>;
  /** Creates the connection and answers where the person authorizes it (the screen goes there). */
  connect(): Promise<{ authorizeUrl: string }>;
  /** Reads what Pluggy has right away; answers the banks that brought something new. */
  sync(): Promise<{ changed: string[] }>;
  rename(itemId: string, name: string): Promise<void>;
  remove(itemId: string): Promise<void>;
  getAlerts(): Promise<BankAlertsView>;
  saveAlerts(choices: BankAlertChoices): Promise<BankAlertsView>;
  /** The month's check (none: this month; only this one and the one before). */
  getReview(month?: Month): Promise<BankReview>;
  /** One decision about one line; answers the month's check again. */
  review(action: BankReviewAction, month?: Month): Promise<BankReview>;
  /** How many lines of a month (none: this one) still ask for a tap, by Capital card too. */
  getReviewCounts(month?: Month): Promise<BankReviewCounts>;
  /** Ties a bank card to a Capital card (null: "não informado"). */
  linkCard(accountId: string, cardId: string | null): Promise<void>;
  /** What can feed the Reserva and what is marked. */
  getReserve(): Promise<BankReserve>;
  /** Marks what feeds the Reserva (both empty: back to typing it). */
  setReserve(accounts: string[], investments: string[]): Promise<BankReserve>;
  /** The stocks and funds the banks hold, for the Diagrama to compare quantities. */
  getHoldings(): Promise<BankHoldings>;
  disconnect(): Promise<void>;
}

export class HttpBanksRepository implements BanksRepository {
  getOverview(): Promise<BanksOverviewResult> {
    return apiRequest('GET', '/banks');
  }

  saveKey(clientId: string, clientSecret: string): Promise<void> {
    return apiRequest('PUT', '/banks/key', { clientId, clientSecret });
  }

  connect(): Promise<{ authorizeUrl: string }> {
    return apiRequest('POST', '/banks/connections');
  }

  sync(): Promise<{ changed: string[] }> {
    return apiRequest('POST', '/banks/sync');
  }

  rename(itemId: string, name: string): Promise<void> {
    return apiRequest('PATCH', `/banks/connections/${seg(itemId)}`, { name });
  }

  remove(itemId: string): Promise<void> {
    return apiRequest('DELETE', `/banks/connections/${seg(itemId)}`);
  }

  getAlerts(): Promise<BankAlertsView> {
    return apiRequest('GET', '/banks/alerts');
  }

  saveAlerts(choices: BankAlertChoices): Promise<BankAlertsView> {
    return apiRequest('PUT', '/banks/alerts', choices);
  }

  getReview(month?: Month): Promise<BankReview> {
    return apiRequest('GET', `/banks/review${month ? `?month=${seg(month)}` : ''}`);
  }

  review(action: BankReviewAction, month?: Month): Promise<BankReview> {
    return apiRequest('POST', `/banks/review${month ? `?month=${seg(month)}` : ''}`, action);
  }

  getReviewCounts(month?: Month): Promise<BankReviewCounts> {
    return apiRequest('GET', `/banks/review/counts${month ? `?month=${seg(month)}` : ''}`);
  }

  linkCard(accountId: string, cardId: string | null): Promise<void> {
    return apiRequest('PUT', `/banks/cards/${seg(accountId)}`, { cardId });
  }

  getReserve(): Promise<BankReserve> {
    return apiRequest('GET', '/banks/reserve');
  }

  setReserve(accounts: string[], investments: string[]): Promise<BankReserve> {
    return apiRequest('PUT', '/banks/reserve', { accounts, investments });
  }

  getHoldings(): Promise<BankHoldings> {
    return apiRequest('GET', '/banks/holdings');
  }

  disconnect(): Promise<void> {
    return apiRequest('DELETE', '/banks');
  }
}
