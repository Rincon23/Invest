import Dexie, { type Table } from 'dexie';
import type { BudgetSettings, MonthData } from '../budget/types';

/** Fixed id for the single settings row (v1 is single-user; see BudgetRepository docs). */
export const SETTINGS_ID = 'default';

export interface SettingsRecord extends BudgetSettings {
  id: string;
}

export class CapitalDatabase extends Dexie {
  settings!: Table<SettingsRecord, string>;
  months!: Table<MonthData, string>;

  constructor() {
    super('capital-db');
    this.version(1).stores({
      settings: 'id',
      months: 'month',
    });
  }
}

export const db = new CapitalDatabase();
