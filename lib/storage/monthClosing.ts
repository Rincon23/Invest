import type { Month, MonthData } from '../budget/types';
import { apiRequest, seg } from './apiClient';

/** The months before `month`, from the first still open (none open: empty). */
export function fetchMonthsToClose(month: Month): Promise<MonthData[]> {
  return apiRequest('GET', `/months/${seg(month)}/to-close`);
}

/** "Fechar todos os meses anteriores"; `dropLeftovers` keeps what was left out of `month`. */
export function closeMonthsBefore(month: Month, dropLeftovers: boolean): Promise<void> {
  return apiRequest('POST', `/months/${seg(month)}/close-before`, { dropLeftovers });
}
