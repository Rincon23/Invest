'use client';

import { useEffect, useRef } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { Month } from '@/lib/budget';
import { useOneTimeHint } from '@/components/ui/useOneTimeHint';
import { useMonthSwipe } from './MonthSwipe';

/** One notice for every screen with a month: whoever learned it in Lançamentos knows it in the Cartão. */
export const MONTH_SWIPE_HINT = 'hint:swipe-month';

/**
 * Under the month of a screen that swipes (Lançamentos, Categorias, the bill), the first time: that
 * sliding sideways changes the month. It goes by itself, or as soon as the month changes.
 */
export function MonthSwipeHint({ month }: { month: Month }) {
  const swipes = useMonthSwipe() !== null;
  const { visible, dismiss } = useOneTimeHint(MONTH_SWIPE_HINT, { when: swipes });
  const first = useRef(month);

  useEffect(() => {
    if (month !== first.current) dismiss();
  }, [month, dismiss]);

  if (!visible) return null;
  return (
    <span role="status" className="text-primary flex items-center gap-1 text-[11px] leading-tight font-medium">
      <ArrowLeftRight aria-hidden className="motion-safe:animate-sway h-3 w-3" />
      Deslize para trocar o mês
    </span>
  );
}
