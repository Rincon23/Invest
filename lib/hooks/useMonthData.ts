'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  computeMonthSummary,
  type Expense,
  type Income,
  type LateExpenseDestination,
  type Month,
  type MonthData,
  type MonthSummary,
  type TagKind,
  type TopicConfig,
} from '@/lib/budget';
import {
  budgetRepository,
  saveNewExpense as saveNewExpenseIn,
  setEntryTags as setEntryTagsIn,
  undoLateExpense,
} from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';

export interface UseMonthDataResult {
  monthData: MonthData | null;
  summary: MonthSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveExpense: (expense: Expense) => Promise<void>;
  /**
   * A new expense of "Lançar gasto": dated in an earlier month already in use, it goes there (see
   * `lateExpenseDestination`), which the answer says.
   */
  saveNewExpense: (expense: Expense) => Promise<LateExpenseDestination | null>;
  deleteExpense: (expenseId: string) => Promise<void>;
  /** "Desfazer" of a new expense that went to the earlier month `destination`. */
  undoLateExpense: (destination: Month, expenseId: string) => Promise<void>;
  saveIncome: (income: Income) => Promise<void>;
  deleteIncome: (incomeId: string) => Promise<void>;
  /** The tags of an expense or income; allowed in a closed month too (they change no number). */
  setEntryTags: (kind: TagKind, entryId: string, tagIds: string[]) => Promise<void>;
  /**
   * With `openNext`, also opens the following month; with `dropLeftovers`, the month after this
   * one starts without its leftovers.
   */
  closeMonth: (openNext?: boolean, dropLeftovers?: boolean) => Promise<void>;
  reopenMonth: () => Promise<void>;
  deleteMonth: () => Promise<void>;
}

/**
 * Loads (creating if needed) and mutates a single competence month, backed by the repository.
 * `currentTopics` (live settings) is forwarded to `computeMonthSummary` for colors only.
 */
export function useMonthData(month: Month, currentTopics?: TopicConfig[]): UseMonthDataResult {
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Navigating to a month must not persist it — only an actual expense/income
      // (or an explicit "close month") creates the stored record. See BudgetRepository.peekMonth.
      const data = await budgetRepository.peekMonth(month);
      setMonthData(data);
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Erro ao carregar o mês.'));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    // IndexedDB has no synchronous or Suspense-compatible read API, so a month can only
    // be loaded after mount; this is the standard "fetch on mount" effect pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const guard = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      setError(null);
      try {
        const result = await action();
        await refresh();
        return result;
      } catch (err) {
        setError(toStorageErrorMessage(err, 'Erro ao salvar.'));
        throw err;
      }
    },
    [refresh],
  );

  const saveExpense = useCallback(
    (expense: Expense) => guard(() => budgetRepository.saveExpense(month, expense)),
    [guard, month],
  );
  const saveNewExpense = useCallback(
    (expense: Expense) => guard(() => saveNewExpenseIn(month, expense)),
    [guard, month],
  );
  const deleteExpense = useCallback(
    (id: string) => guard(() => budgetRepository.deleteExpense(month, id)),
    [guard, month],
  );
  const undoLate = useCallback(
    (destination: Month, id: string) => guard(() => undoLateExpense(destination, id)),
    [guard],
  );
  const saveIncome = useCallback(
    (income: Income) => guard(() => budgetRepository.saveIncome(month, income)),
    [guard, month],
  );
  const deleteIncome = useCallback(
    (id: string) => guard(() => budgetRepository.deleteIncome(month, id)),
    [guard, month],
  );
  const setEntryTags = useCallback(
    (kind: TagKind, id: string, tagIds: string[]) => guard(() => setEntryTagsIn(month, kind, id, tagIds)),
    [guard, month],
  );
  const closeMonth = useCallback(
    (openNext = false, dropLeftovers = false) =>
      guard(() => budgetRepository.closeMonth(month, openNext, dropLeftovers)),
    [guard, month],
  );
  const reopenMonth = useCallback(() => guard(() => budgetRepository.reopenMonth(month)), [guard, month]);
  const deleteMonth = useCallback(() => guard(() => budgetRepository.deleteMonth(month)), [guard, month]);

  const summary = monthData ? computeMonthSummary(monthData, currentTopics) : null;

  return {
    monthData,
    summary,
    loading,
    error,
    refresh,
    saveExpense,
    saveNewExpense,
    deleteExpense,
    undoLateExpense: undoLate,
    saveIncome,
    deleteIncome,
    setEntryTags,
    closeMonth,
    reopenMonth,
    deleteMonth,
  };
}
