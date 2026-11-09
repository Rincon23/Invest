'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ModuleKey } from '@/lib/budget';
import { isModuleOn } from '@/lib/modules';
import { useSettings } from '@/components/providers/SettingsProvider';

/** The notice key that says a person already had a module's introduction. */
export const introNotice = (module: ModuleKey) => `intro:${module}`;

/** Introductions already started in this tab, so a re-render never starts one twice. */
const started = new Set<string>();

/**
 * The first time a person opens a module that needs initial configuration (`withSetup`), it asks
 * its setup questions on its own — remembered per account in the settings' dismissed notices, so
 * it happens once, on whichever device comes first. Modules without setup no longer do anything
 * here: the guided tour never starts by itself anymore, only from that module's help button
 * (`ModuleHelpButton`), so exploring a new tab does not interrupt the person with a spotlight
 * they did not ask for.
 *
 * `ready` is when the screen has its content on screen (the setup wizard needs its data).
 */
export function useModuleIntro(module: ModuleKey, { ready, withSetup = false }: { ready: boolean; withSetup?: boolean }) {
  const { settings, saveSettings } = useSettings();
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    if (!ready || !settings || !withSetup || !isModuleOn(settings, module)) return;
    const key = introNotice(module);
    if (settings.dismissedNotices?.includes(key) || started.has(key)) return;
    started.add(key);

    void saveSettings({ ...settings, dismissedNotices: [...(settings.dismissedNotices ?? []), key] }).catch(
      () => started.delete(key),
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSetupOpen(true);
  }, [ready, settings, saveSettings, module, withSetup]);

  /** The setup was finished or skipped: just closes it. The help button opens the tour if wanted. */
  const finishSetup = useCallback(() => {
    setSetupOpen(false);
  }, []);

  return { setupOpen, finishSetup };
}
