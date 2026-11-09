import type { Month, PendingReimbursable } from '../budget/types';
import { apiRequest, seg } from './apiClient';

/** Every "A receber" still not paid back, from `until` and the months before it. */
export function listPendingReimbursables(until: Month): Promise<PendingReimbursable[]> {
  return apiRequest('GET', `/reimbursables?ate=${encodeURIComponent(until)}`);
}

/** "Já me pagou" (an ISO instant) or undoing it (null), in any month, closed ones included. */
export function setReimbursed(month: Month, expenseId: string, reimbursedAt: string | null): Promise<void> {
  return apiRequest('PUT', `/months/${seg(month)}/expenses/${seg(expenseId)}/reimbursed`, { reimbursedAt });
}
