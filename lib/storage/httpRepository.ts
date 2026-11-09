import type { BudgetSettings, Expense, Income, Month, MonthData } from '../budget/types';
import { ApiRequestError, apiRequest, seg, UNAUTHENTICATED_EVENT } from './apiClient';
import type { BackupPayload, BudgetRepository } from './repository';

export { ApiRequestError, UNAUTHENTICATED_EVENT };

/**
 * Browser-side BudgetRepository: every call goes to the app's own API (/api/v1, same origin,
 * session cookie), which runs the Postgres repository on the server for the signed-in user.
 */
export class HttpBudgetRepository implements BudgetRepository {
  getSettings(): Promise<BudgetSettings> {
    return apiRequest('GET', '/settings');
  }

  saveSettings(settings: BudgetSettings): Promise<void> {
    return apiRequest('PUT', '/settings', settings);
  }

  completeOnboarding(): Promise<void> {
    return apiRequest('POST', '/settings/onboarding');
  }

  listMonths(): Promise<Month[]> {
    return apiRequest('GET', '/months');
  }

  async getMonth(month: Month): Promise<MonthData | undefined> {
    try {
      return await apiRequest<MonthData>('GET', `/months/${seg(month)}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'MONTH_NOT_FOUND') return undefined;
      throw err;
    }
  }

  peekMonth(month: Month): Promise<MonthData> {
    return apiRequest('GET', `/months/${seg(month)}/peek`);
  }

  ensureMonth(month: Month): Promise<MonthData> {
    return apiRequest('POST', `/months/${seg(month)}/ensure`);
  }

  saveIncome(month: Month, income: Income): Promise<void> {
    return apiRequest('PUT', `/months/${seg(month)}/incomes/${seg(income.id)}`, income);
  }

  deleteIncome(month: Month, incomeId: string): Promise<void> {
    return apiRequest('DELETE', `/months/${seg(month)}/incomes/${seg(incomeId)}`);
  }

  saveExpense(month: Month, expense: Expense): Promise<void> {
    return apiRequest('PUT', `/months/${seg(month)}/expenses/${seg(expense.id)}`, expense);
  }

  deleteExpense(month: Month, expenseId: string): Promise<void> {
    return apiRequest('DELETE', `/months/${seg(month)}/expenses/${seg(expenseId)}`);
  }

  closeMonth(month: Month, openNext = false, dropLeftovers = false): Promise<void> {
    return apiRequest('POST', `/months/${seg(month)}/close`, { openNext, dropLeftovers });
  }

  reopenMonth(month: Month): Promise<void> {
    return apiRequest('POST', `/months/${seg(month)}/reopen`);
  }

  deleteMonth(month: Month): Promise<void> {
    return apiRequest('DELETE', `/months/${seg(month)}`);
  }

  exportData(): Promise<BackupPayload> {
    return apiRequest('GET', '/backup');
  }

  importData(payload: BackupPayload): Promise<void> {
    return apiRequest('POST', '/backup', payload);
  }

  clearAll(): Promise<void> {
    return apiRequest('DELETE', '/data');
  }
}
