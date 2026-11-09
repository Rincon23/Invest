import type { LateExpenseDestination } from '../budget/rollover';
import type { Expense, Month } from '../budget/types';
import { apiRequest, seg } from './apiClient';

/**
 * A new expense of "Lançar gasto", entered in `month`. Dated in an earlier month already in use, it
 * goes there, even if closed; the answer says where (null: it stayed in `month`).
 */
export async function saveNewExpense(month: Month, expense: Expense): Promise<LateExpenseDestination | null> {
  const { destination } = await apiRequest<{ destination: LateExpenseDestination | null }>(
    'POST',
    `/months/${seg(month)}/expenses`,
    expense,
  );
  return destination;
}

/** Where a new expense dated `date` would go from `month`, for the form to say before saving. */
export async function fetchLateExpenseDestination(
  month: Month,
  date: string,
): Promise<LateExpenseDestination | null> {
  const { destination } = await apiRequest<{ destination: LateExpenseDestination | null }>(
    'GET',
    `/months/${seg(month)}/late-destination?data=${seg(date)}`,
  );
  return destination;
}

/** "Desfazer" of an expense that `saveNewExpense` just put in an earlier month, maybe closed. */
export function undoLateExpense(month: Month, expenseId: string): Promise<void> {
  return apiRequest('POST', `/months/${seg(month)}/expenses/${seg(expenseId)}/undo`);
}
