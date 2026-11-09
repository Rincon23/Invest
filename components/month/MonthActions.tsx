'use client';

import type { CategoryKind } from '@/lib/budget';
import { HOME_DOTS_LANE, HOME_FOOTER_HEIGHT } from '@/components/modules/home/homeLayout';
import { Fab } from '@/components/ui/Fab';
import { useMonthContext } from './MonthContext';

/** How far above the bottom edge the buttons float: over the Início's dots and up-arrow, or near the edge. */
const BOTTOM = {
  home: `calc(env(safe-area-inset-bottom) + ${HOME_FOOTER_HEIGHT} + ${HOME_DOTS_LANE} + 0.5rem)`,
  screen: 'calc(env(safe-area-inset-bottom) + 1rem)',
};

/**
 * The floating "Renda" and "Lançar gasto" buttons.
 * On the Início they float just above the squares and the up-arrow (`placement="home"`); on any other
 * screen, near the bottom edge, which then leaves room for them (`MONTH_ACTIONS_PADDING`).
 */
export function MonthActions({
  defaultCategoryKind,
  placement = 'screen',
}: {
  defaultCategoryKind?: CategoryKind;
  placement?: keyof typeof BOTTOM;
}) {
  const { openExpenseForm, openIncomeForm } = useMonthContext();

  return (
    <div className="fixed right-4 z-30 flex flex-col items-end gap-2" style={{ bottom: BOTTOM[placement] }}>
      <Fab label="Renda" variant="secondary" onClick={() => openIncomeForm()} tourId="fab-renda" />
      <Fab
        label="Lançar gasto"
        onClick={() => openExpenseForm(undefined, defaultCategoryKind)}
        tourId="fab-lancar-gasto"
      />
    </div>
  );
}

/** Bottom space for a screen with `MonthActions`, so the last item is never under the buttons. */
export const MONTH_ACTIONS_PADDING = 'pb-[calc(9rem+env(safe-area-inset-bottom))]';
