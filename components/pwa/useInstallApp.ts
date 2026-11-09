'use client';

import { useCallback, useEffect, useState } from 'react';
import { isInstalledApp, isIosDevice } from '@/lib/notifications/browser';

/** Chrome's (and Edge's, Samsung Internet's) install prompt; not in the DOM typings yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __capitalInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

const INSTALLABLE_EVENT = 'capital:installable';

/**
 * Runs in <head>, before React: the browser may offer the install prompt before any component
 * mounts, and the event is not fired twice. It is kept so the "Instalar o app" button can show it.
 */
export const INSTALL_CAPTURE_SCRIPT = `(function(){window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__capitalInstallPrompt=e;window.dispatchEvent(new Event('${INSTALLABLE_EVENT}'));});window.addEventListener('appinstalled',function(){window.__capitalInstallPrompt=null;});})();`;

export type InstallPlatform = 'android' | 'ios' | 'desktop';

function detectPlatform(): InstallPlatform {
  if (isIosDevice()) return 'ios';
  if (/android|mobile/i.test(navigator.userAgent)) return 'android';
  return 'desktop';
}

interface InstallApp {
  /** Known only after mounting; until then nothing about installing is shown. */
  ready: boolean;
  /** Already running as the installed app (opened from its icon). */
  standalone: boolean;
  /** Installed in this visit, from the browser. */
  installed: boolean;
  /** The browser can install it with one tap (its own "Instalar app?" dialog). */
  canPrompt: boolean;
  platform: InstallPlatform;
  /** Opens the browser's own dialog; false when there is none to open (show the how-to instead). */
  prompt: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export function useInstallApp(): InstallApp {
  const [ready, setReady] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>('desktop');

  useEffect(() => {
    const refresh = () => setCanPrompt(Boolean(window.__capitalInstallPrompt));
    const onInstalled = () => {
      setInstalled(true);
      setCanPrompt(false);
    };
    // Read from the browser once mounted (the server can't know any of this).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStandalone(isInstalledApp());
    setPlatform(detectPlatform());
    refresh();
    setReady(true);
    window.addEventListener(INSTALLABLE_EVENT, refresh);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener(INSTALLABLE_EVENT, refresh);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const prompt = useCallback(async () => {
    const event = window.__capitalInstallPrompt;
    if (!event) return 'unavailable' as const;
    // The event can be shown only once; a new one comes if the browser offers it again.
    window.__capitalInstallPrompt = null;
    setCanPrompt(false);
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    return outcome;
  }, []);

  return { ready, standalone, installed, canPrompt, platform, prompt };
}
