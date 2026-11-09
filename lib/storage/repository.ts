import type { AppSettings } from '../core/types';
import type { DiagramBackup } from '../diagram/types';

/** What a backup exported today declares. */
export const BACKUP_VERSION = 1;

/** "Exportar dados": the account's settings and its whole Diagrama. */
export interface BackupPayload {
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  diagram: DiagramBackup;
}

/** Thrown by cloud-backed repositories when there is no signed-in user. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('Sessão expirada. Entre novamente para continuar.');
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * The account's settings and data as a whole. The UI never talks to the API or the database
 * directly: in the browser it is `HttpSettingsRepository` (the app's own API).
 */
export interface SettingsRepository {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  /** Marks this account as having seen the welcome, for good. */
  completeOnboarding(): Promise<void>;

  exportData(): Promise<BackupPayload>;
  importData(payload: BackupPayload): Promise<void>;
  clearAll(): Promise<void>;
}
