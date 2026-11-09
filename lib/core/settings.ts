import type { AppSettings } from './types';

/** The settings of a brand-new account: it still has the welcome to see. */
export function createDefaultSettings(): AppSettings {
  return { onboardingCompleted: false };
}

/** The settings with every list in place, so screens read them without checking again. */
export function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    dismissedNotices: settings.dismissedNotices ?? [],
    homeHidden: settings.homeHidden ?? [],
  };
}
