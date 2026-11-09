'use client';

import { useEffect, useState } from 'react';
import { currentMonthKey, type Month } from '@/lib/budget';
import { getLastViewedMonth } from '@/lib/storage/preferences';

/**
 * The month the user was last looking at, for screens without a month in the URL. Starts from
 * the current month (what the server renders too) and switches to the stored one after mount, so
 * hydration always matches.
 */
export function useLastViewedMonth(): Month {
  const [month, setMonth] = useState<Month>(currentMonthKey);

  useEffect(() => {
    const stored = getLastViewedMonth();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setMonth(stored);
  }, []);

  return month;
}
