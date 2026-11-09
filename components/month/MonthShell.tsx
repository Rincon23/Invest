'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  computeMonthSummary,
  currentMonthKey,
  expenseFeedback,
  formatMonthName,
  resolveSpecialCategoryLabels,
  withCurrentTopicDisplay,
  type CategoryKind,
  type Expense,
  type Income,
  type Month,
} from '@/lib/budget';
import { useMonthData } from '@/lib/hooks/useMonthData';
import { isModuleOn } from '@/lib/modules';
import { budgetRepository, fetchLateExpenseDestination, walletRepository } from '@/lib/storage';
import { setLastViewedMonth } from '@/lib/storage/preferences';
import { useSettings } from '@/components/providers/SettingsProvider';
import { subscribeTourSheets } from '@/components/modules/tour/tourSheets';
import { InstallmentEditor, type InstallmentEditRequest } from '@/components/card/InstallmentEditor';
import { useToast } from '@/components/ui/Toast';
import { MonthContext } from './MonthContext';
import { ExpenseFormSheet } from './ExpenseFormSheet';
import { IncomeFormSheet } from './IncomeFormSheet';

type ExpenseFormState =
  | {
      open: true;
      initial?: Expense;
      defaultCategoryKind?: CategoryKind;
      /** Editing one instalment on its own, which the form says out loud. */
      singleInstallment?: boolean;
      /** Opened by a tour to show the form: no keyboard popping up over it. */
      forTour?: boolean;
    }
  | { open: false };
type IncomeFormState = { open: true; initial?: Income } | { open: false };

/** The line shown while a single instalment is being edited, so the scope stays clear. */
const SINGLE_INSTALLMENT_NOTE = 'Só a parcela deste mês.';

export function MonthShell({ month, children }: { month: Month; children: ReactNode }) {
  const { settings } = useSettings();
  const monthData = useMonthData(month, settings?.topics);
  const { showToast } = useToast();

  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>({ open: false });
  const [incomeForm, setIncomeForm] = useState<IncomeFormState>({ open: false });
  const [installmentEdit, setInstallmentEdit] = useState<InstallmentEditRequest | null>(null);

  useEffect(() => {
    setLastViewedMonth(month);
  }, [month]);

  // A tour step can ask for the expense form (the card question, "A receber").
  useEffect(
    () =>
      subscribeTourSheets((request) => {
        if (request === 'close') {
          setExpenseForm({ open: false });
        } else {
          setExpenseForm({
            open: true,
            forTour: true,
            defaultCategoryKind: request === 'expense-form-reimbursable' ? 'reimbursable' : undefined,
          });
        }
      }),
    [],
  );

  /**
   * Tapping an entry. An instalment is not an ordinary line — it belongs to a purchase that
   * spans months — so it asks what the person means to change (see `InstallmentEditor`); the
   * single expense of an "à vista" purchase *is* the purchase, and opens it straight away.
   */
  const openExpenseForm = useCallback((initial?: Expense, defaultCategoryKind?: CategoryKind) => {
    if (initial?.installmentId) {
      setInstallmentEdit(
        initial.installmentNumber === 0
          ? { kind: 'plan', installmentId: initial.installmentId }
          : {
              kind: 'scope',
              expense: initial,
              installmentId: initial.installmentId,
              number: initial.installmentNumber ?? 1,
            },
      );
      return;
    }
    setExpenseForm({ open: true, initial, defaultCategoryKind });
  }, []);
  const openIncomeForm = useCallback((initial?: Income) => {
    setIncomeForm({ open: true, initial });
  }, []);
  const lateDestinationOf = useCallback((date: string) => fetchLateExpenseDestination(month, date), [month]);

  // A hard storage failure (e.g. the server or its database unreachable) leaves monthData
  // null forever; show the error instead of letting every child spin on "Carregando…".
  if (monthData.error && !monthData.monthData) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-foreground text-sm font-medium">Não foi possível carregar este mês</p>
        <p className="text-muted text-sm">{monthData.error}</p>
        <button
          type="button"
          onClick={() => void monthData.refresh()}
          disabled={monthData.loading}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 font-semibold disabled:opacity-50"
        >
          {monthData.loading ? 'Tentando…' : 'Tentar novamente'}
        </button>
      </div>
    );
  }

  /**
   * A new expense (the form): saved, then a toast with what it did to its category,
   * with "Desfazer" — how the category is learned by using it. Editing one says nothing.
   * Dated in an earlier month already in use, it went there (`saveNewExpense`), and the toast says
   * so: with that month's leftovers reaching this one, this month's numbers are the ones that moved.
   */
  async function saveNewExpense(expense: Expense) {
    const destination = await monthData.saveNewExpense(expense);
    if (!settings) return;
    const elsewhere = destination && !destination.reachesFrom ? destination.month : null;
    const summary = !isModuleOn(settings, 'budget')
      ? null
      : elsewhere
        ? await budgetRepository
            .peekMonth(elsewhere)
            .then((data) => computeMonthSummary(data, settings.topics))
            .catch(() => null)
        : monthData.summary;
    const feedback = expenseFeedback({
      expense,
      summary,
      counted: Boolean(elsewhere),
      labels: resolveSpecialCategoryLabels(settings.specialCategories),
      month: elsewhere ?? month,
      currentMonth: currentMonthKey(),
    });
    const message = destination
      ? `Lançado em ${formatMonthName(destination.month).toLowerCase()}. ${feedback}`
      : feedback;
    showToast(message, 'success', {
      action: {
        label: 'Desfazer',
        onClick: () => {
          void (
            destination
              ? monthData.undoLateExpense(destination.month, expense.id)
              : monthData.deleteExpense(expense.id)
          )
            .then(() => showToast('Gasto desfeito.', 'info'))
            .catch(() => showToast('Não foi possível desfazer. Tente de novo.', 'error'));
        },
      },
    });
  }

  return (
    <MonthContext.Provider
      value={{
        ...monthData,
        month,
        openExpenseForm,
        openIncomeForm,
      }}
    >
      {children}

      {installmentEdit && (
        <InstallmentEditor
          request={installmentEdit}
          onClose={() => setInstallmentEdit(null)}
          onChanged={() => monthData.refresh()}
          onEditSingle={(expense) => {
            setInstallmentEdit(null);
            setExpenseForm({ open: true, initial: expense, singleInstallment: true });
          }}
        />
      )}

      {expenseForm.open && settings && (
        <ExpenseFormSheet
          month={month}
          topics={
            monthData.monthData
              ? withCurrentTopicDisplay(
                  monthData.monthData.topicsSnapshot,
                  settings.topics,
                  month >= currentMonthKey(),
                )
              : settings.topics
          }
          specialCategories={settings.specialCategories}
          reimbursableEnabled={isModuleOn(settings, 'reimbursable')}
          cardEnabled={isModuleOn(settings, 'card')}
          initial={expenseForm.initial}
          defaultCategoryKind={expenseForm.defaultCategoryKind}
          autoFocusAmount={!expenseForm.forTour}
          note={expenseForm.singleInstallment ? SINGLE_INSTALLMENT_NOTE : undefined}
          tagsOnly={Boolean(expenseForm.initial && monthData.monthData?.closed)}
          onSaveTags={
            expenseForm.initial
              ? (tagIds) => monthData.setEntryTags('expense', expenseForm.initial!.id, tagIds)
              : undefined
          }
          onClose={() => setExpenseForm({ open: false })}
          onSave={expenseForm.initial ? monthData.saveExpense : saveNewExpense}
          lateDestinationOf={expenseForm.initial ? undefined : lateDestinationOf}
          onDelete={monthData.deleteExpense}
          onSaveInstallment={
            isModuleOn(settings, 'card')
              ? async (plan) => {
                  await walletRepository.saveInstallment(plan);
                  await monthData.refresh();
                }
              : undefined
          }
        />
      )}

      {incomeForm.open && (
        <IncomeFormSheet
          month={month}
          initial={incomeForm.initial}
          topics={
            settings && isModuleOn(settings, 'budget')
              ? monthData.monthData
                ? withCurrentTopicDisplay(
                    monthData.monthData.topicsSnapshot,
                    settings.topics,
                    month >= currentMonthKey(),
                  )
                : settings.topics
              : undefined
          }
          tagsOnly={Boolean(incomeForm.initial && monthData.monthData?.closed)}
          onSaveTags={
            incomeForm.initial
              ? (tagIds) => monthData.setEntryTags('income', incomeForm.initial!.id, tagIds)
              : undefined
          }
          onClose={() => setIncomeForm({ open: false })}
          onSave={monthData.saveIncome}
          onDelete={monthData.deleteIncome}
        />
      )}
    </MonthContext.Provider>
  );
}
