'use client';

import { useState } from 'react';
import type { ModuleKey } from '@/lib/budget';
import { mayUseModule } from '@/lib/modules';
import { useAuth } from '@/components/providers/AuthProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import {
  NOTIFICATION_CATEGORY_LABELS,
  isNotificationCategoryOn,
  type NotificationCategory,
} from '@/lib/notifications';

const TOGGLEABLE: NotificationCategory[] = ['reminder', 'card', 'recurring', 'banks', 'feature', 'motivation'];
/**
 * The module each category comes from. A module only for VIP accounts never notifies anyone else,
 * so they don't see its switch.
 */
const CATEGORY_MODULE: Partial<Record<NotificationCategory, ModuleKey>> = {
  reminder: 'reminders',
  card: 'card',
  recurring: 'recurring',
  banks: 'banks',
};

/**
 * Which kinds of notification push to the phone. A PWA has no way to create separate channels
 * in the phone's own notification settings (only a native Android/iOS app can do that) — the
 * browser gives one on/off switch per site (above, in "Neste aparelho"). This is the closest
 * equivalent inside the app: a switch per kind, so a device can still get lembretes without
 * getting every novidade. Everything keeps showing up in the Central de notificações regardless.
 */
export function NotificationPreferencesSection() {
  const { settings, saveSettings } = useSettings();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [saving, setSaving] = useState<NotificationCategory | null>(null);

  if (!settings) return null;
  const prefs = settings.notificationPrefs;

  const toggle = async (category: NotificationCategory, checked: boolean) => {
    setSaving(category);
    try {
      await saveSettings({ ...settings, notificationPrefs: { ...prefs, [category]: checked } });
    } catch {
      showToast('Não foi possível salvar. Tente de novo.', 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted text-sm font-semibold">Quais avisos chegam no celular</h2>
      <div className="border-border bg-card flex flex-col gap-4 rounded-xl border p-4 shadow-sm">
        <p className="text-muted text-xs">
          Quais avisos chegam no celular.
        </p>
        {TOGGLEABLE.filter((category) => {
          const source = CATEGORY_MODULE[category];
          return !source || mayUseModule(user, source);
        }).map((category) => (
          <div key={category} className="flex items-center justify-between gap-3">
            <span className="text-foreground text-sm font-medium">
              {NOTIFICATION_CATEGORY_LABELS[category]}
            </span>
            <Switch
              checked={isNotificationCategoryOn(prefs, category)}
              onChange={(checked) => void toggle(category, checked)}
              disabled={saving !== null}
              label={NOTIFICATION_CATEGORY_LABELS[category]}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
