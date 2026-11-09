'use client';

import { useEffect } from 'react';
import {
  currentSubscription,
  pushSupport,
  rememberEndpoint,
  rememberedEndpoint,
  subscriptionInput,
} from '@/lib/notifications/browser';
import { notificationsRepository } from '@/lib/storage';

/**
 * Keeps the server's copy of this browser's push subscription current. Browsers renew
 * subscriptions now and then; the service worker reports that too, but only while it is
 * running, so the app checks again on every start. A browser that never turned notifications
 * on (nothing remembered) is left alone.
 */
export function PushSubscriptionSync() {
  useEffect(() => {
    async function sync() {
      if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return;
      const remembered = rememberedEndpoint();
      const subscription = await currentSubscription();
      if (!remembered || !subscription || subscription.endpoint === remembered) return;
      await notificationsRepository.registerDevice({
        ...subscriptionInput(subscription),
        previousEndpoint: remembered,
      });
      rememberEndpoint(subscription.endpoint);
    }
    sync().catch(() => {
      // Best effort: the next start tries again.
    });
  }, []);

  return null;
}
