'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { currentMonthKey } from '@/lib/budget';
import { OPEN_APPS_PARAM, homeHref } from '@/lib/modules';

/**
 * Sends the person to the Início, which is always the month of today (another month is seen
 * inside the screens that have one, like Lançamentos): what "/" does, and where the old addresses
 * of the bottom-bar era land (`/rodape`, and `/mais`, with the app drawer open). Done in the
 * browser, so "today" is the person's own.
 */
export function HomeRedirect({ openApps = false }: { openApps?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const href = homeHref(currentMonthKey());
    router.replace(openApps ? `${href}?${OPEN_APPS_PARAM}=1` : href);
  }, [router, openApps]);

  return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
}
