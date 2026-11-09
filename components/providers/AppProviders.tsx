'use client';

import type { ReactNode } from 'react';
import { CardsProvider } from '@/components/cards/CardsProvider';
import { MissionsProvider } from '@/components/missions/MissionsProvider';
import { TourProvider } from '@/components/modules/tour/TourProvider';
import { NotificationsProvider } from '@/components/notifications/NotificationsProvider';
import { ConfirmProvider } from '@/components/ui/ConfirmSheet';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider, type AuthUser } from './AuthProvider';
import { SettingsProvider } from './SettingsProvider';

/** Providers that require a signed-in user. Wraps only the authenticated routes. */
export function AppProviders({
  initialUser,
  children,
}: {
  initialUser: AuthUser;
  children: ReactNode;
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <ToastProvider>
        <ConfirmProvider>
          <SettingsProvider>
            <NotificationsProvider>
              <CardsProvider>
                <TourProvider>
                  <MissionsProvider>{children}</MissionsProvider>
                </TourProvider>
              </CardsProvider>
            </NotificationsProvider>
          </SettingsProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
