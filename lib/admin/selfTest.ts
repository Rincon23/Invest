import { moduleDefinition } from '../modules';
import type { SelfTestArea, SelfTestResult, SelfTestStatus } from './types';

/** "Servidor", or the module's own name ("Cartão", "Lembretes"). */
export function selfTestAreaName(area: SelfTestArea): string {
  return area === 'server' ? 'Servidor' : moduleDefinition(area).name;
}

export function countByStatus(results: SelfTestResult[]): Record<SelfTestStatus, number> {
  const counts: Record<SelfTestStatus, number> = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

/** The worst of a group: one failure makes the whole module red, a warning amber. */
export function worstStatus(results: SelfTestResult[]): SelfTestStatus {
  const counts = countByStatus(results);
  if (counts.fail > 0) return 'fail';
  if (counts.warn > 0) return 'warn';
  return counts.ok > 0 ? 'ok' : 'skip';
}
