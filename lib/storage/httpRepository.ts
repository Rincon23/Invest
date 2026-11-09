import type { AppSettings } from '../core/types';
import { ApiRequestError, apiRequest, UNAUTHENTICATED_EVENT } from './apiClient';
import type { BackupPayload, SettingsRepository } from './repository';

export { ApiRequestError, UNAUTHENTICATED_EVENT };

/**
 * Browser-side SettingsRepository: every call goes to the app's own API (/api/v1, same origin,
 * session cookie), which runs the Postgres repository on the server for the signed-in user.
 */
export class HttpSettingsRepository implements SettingsRepository {
  getSettings(): Promise<AppSettings> {
    return apiRequest('GET', '/settings');
  }

  saveSettings(settings: AppSettings): Promise<void> {
    return apiRequest('PUT', '/settings', settings);
  }

  completeOnboarding(): Promise<void> {
    return apiRequest('POST', '/settings/onboarding');
  }

  exportData(): Promise<BackupPayload> {
    return apiRequest('GET', '/backup');
  }

  importData(payload: BackupPayload): Promise<void> {
    return apiRequest('POST', '/backup', payload);
  }

  clearAll(): Promise<void> {
    return apiRequest('DELETE', '/data');
  }
}
