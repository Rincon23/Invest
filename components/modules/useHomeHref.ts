'use client';

import { useEffect, useState } from 'react';
import { currentMonthKey, type Month } from '@/lib/budget';
import { homeHref } from '@/lib/modules';

/**
 * Where a screen's back arrow goes: the Início, like closing an app on a phone lands on the home
 * screen. The Início is always the month of today — even from Lançamentos of another month — and
 * "today" is the person's: the server renders its own month first (its clock may already be in
 * the next one), and the browser's takes over after mount, so hydration always matches.
 */
export function useHomeHref(): string {
  const [month, setMonth] = useState<Month>(currentMonthKey);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonth(currentMonthKey());
  }, []);

  return homeHref(month);
}
