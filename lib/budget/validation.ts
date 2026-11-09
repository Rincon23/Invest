import type { CategoryKind, Month, TopicConfig } from './types';

const PCT_EPSILON = 1e-6;

export interface PercentageValidationResult {
  valid: boolean;
  /** Sum of targetPct across active topics, 0..1 (or slightly beyond). */
  totalPct: number;
  /** 1 - totalPct. Positive means percentage points are missing, negative means there's an excess. */
  diffPct: number;
}

/** Validates that active topics' targetPct add up to exactly 100%. */
export function validateTopicPercentages(topics: TopicConfig[]): PercentageValidationResult {
  const totalPct = topics.filter((t) => !t.archived).reduce((total, t) => total + t.targetPct, 0);
  const diffPct = 1 - totalPct;

  return {
    valid: Math.abs(diffPct) < PCT_EPSILON,
    totalPct,
    diffPct,
  };
}

export interface ExpenseValidationInput {
  categoryKind: CategoryKind;
  topicId?: string;
  amount: number;
  date: string;
}

export interface ExpenseValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validates an expense/income amount and required fields. Blocking rules only (date-in-month is a warning, see isDateInMonth). */
export function validateExpense(expense: ExpenseValidationInput): ExpenseValidationResult {
  const errors: string[] = [];

  if (!(expense.amount > 0)) {
    errors.push('O valor deve ser maior que zero.');
  }

  if (expense.categoryKind === 'topic' && !expense.topicId) {
    errors.push('Selecione uma categoria.');
  }

  return { valid: errors.length === 0, errors };
}

/** Non-blocking check: does `date` (ISO) fall within competence `month` ("YYYY-MM")? Used to warn, not block. */
export function isDateInMonth(date: string, month: Month): boolean {
  return date.startsWith(month);
}

export function validatePositiveAmount(amount: number): boolean {
  return amount > 0;
}
