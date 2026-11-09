'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSettings } from '@/components/providers/SettingsProvider';

/** When each hint went up in this tab, so a screen that remounts while it shows keeps it up. */
const shownAt = new Map<string, number>();

/**
 * A small hint shown once per account — the first time `when` holds — that goes away by itself
 * after `duration` ms (or on `dismiss`, when the person did the thing it explains). It is saved in
 * the dismissed notices as soon as it shows, so it never comes back, on any device. Never a tour:
 * just a line on the screen.
 */
export function useOneTimeHint(
  key: string,
  { when = true, duration = 6000 }: { when?: boolean; duration?: number } = {},
) {
  const { settings, saveSettings } = useSettings();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!when || !settings) return;
    const started = shownAt.get(key);
    if (started === undefined) {
      if (settings.dismissedNotices?.includes(key)) return;
      shownAt.set(key, Date.now());
      void saveSettings({ ...settings, dismissedNotices: [...(settings.dismissedNotices ?? []), key] }).catch(
        () => {},
      );
    } else if (Date.now() - started >= duration) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
  }, [when, settings, saveSettings, key, duration]);

  useEffect(() => {
    if (!visible) return;
    const left = duration - (Date.now() - (shownAt.get(key) ?? Date.now()));
    const timer = window.setTimeout(() => setVisible(false), Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [visible, key, duration]);

  const dismiss = useCallback(() => {
    shownAt.set(key, 0);
    setVisible(false);
  }, [key]);

  return { visible: visible && when, dismiss };
}
