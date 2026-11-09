import Dexie from 'dexie';
import { db } from './db';
import { budgetRepository } from './index';
import { IndexedDbBudgetRepository } from './indexedDbRepository';

/**
 * One-time migration of a device's old local data (IndexedDB `capital-db`, used
 * by v1) into the signed-in account. Reuses the existing backup pipeline: local
 * `exportData()` -> account `importData()` (which replaces the account's current data).
 */

const DONE_KEY = 'capital:localImportDone';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function localImportDone(): boolean {
  return Boolean(safeGet(DONE_KEY));
}

export function markLocalImportDone(): void {
  try {
    window.localStorage.setItem(DONE_KEY, '1');
  } catch {
    // Private mode / storage disabled — the banner will simply reappear.
  }
}

/** True if this device still holds v1 data that has not been migrated yet. */
export async function hasLocalData(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return false;
  if (localImportDone()) return false;
  try {
    if (!(await Dexie.exists('capital-db'))) return false;
    const [months, settings] = await Promise.all([db.months.count(), db.settings.count()]);
    return months > 0 || settings > 0;
  } catch {
    return false;
  }
}

/** Copies the local data into the current cloud account, then marks it done. */
export async function importLocalDataToCloud(): Promise<void> {
  const local = new IndexedDbBudgetRepository();
  const payload = await local.exportData();
  await budgetRepository.importData(payload);
  markLocalImportDone();
}
