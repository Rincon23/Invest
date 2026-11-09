'use client';

import { HomeScreen } from '@/components/modules/home/HomeScreen';
import { useSettings } from '@/components/providers/SettingsProvider';

/** Início: the áreas de trabalho of widgets, the up-arrow to every app, and edit mode. */
export function DashboardScreen({ openApps = false }: { openApps?: boolean }) {
  const { settings } = useSettings();

  if (!settings) {
    return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
  }
  return <HomeScreen settings={settings} openApps={openApps} />;
}
