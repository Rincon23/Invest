'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMonthName } from '@/lib/budget';
import type { MonthsToClose } from '@/lib/hooks/useMonthsToClose';
import { useToast } from '@/components/ui/Toast';
import { CloseMonthSheet, closedMonthMessage } from './CloseMonthSheet';
import { useMonthContext } from './MonthContext';

const PRIMARY = 'bg-primary text-primary-foreground min-h-[44px] w-full rounded-lg px-4 py-2 font-semibold';
const OUTLINE = 'border-border text-foreground min-h-[44px] w-full rounded-lg border px-4 py-2 font-medium';

/**
 * "Fechar outubro" and, with more months open, "Fechar todos os meses anteriores": what shows on
 * the Gastos por categoria widget and screen once the month turned (`useMonthsToClose`). The sheet
 * goes to the body: inside the telas of the Início, the track that slides them would carry it along.
 */
export function ClosePastMonths({ summary, target, close, all }: MonthsToClose) {
  const { month, refresh } = useMonthContext();
  const { showToast } = useToast();
  const [closing, setClosing] = useState<'one' | 'all' | null>(null);
  const name = formatMonthName(summary.month).toLowerCase();
  const picked =
    closing === 'all' && all
      ? { ...all, target: month }
      : { summary, target, close, months: undefined };

  async function handleConfirm(bringLeftovers: boolean) {
    try {
      await picked.close(bringLeftovers);
      setClosing(null);
      showToast(closedMonthMessage(picked.summary, picked.target, bringLeftovers, picked.months));
      await refresh();
    } catch {
      showToast('Não foi possível fechar o mês. Tente de novo.', 'error');
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {all && (
          <button type="button" onClick={() => setClosing('all')} className={PRIMARY}>
            Fechar todos os meses anteriores
          </button>
        )}
        <button type="button" onClick={() => setClosing('one')} className={all ? OUTLINE : PRIMARY}>
          {all ? `Fechar só ${name}` : `Fechar ${name}`}
        </button>
      </div>

      {closing &&
        createPortal(
          <CloseMonthSheet
            summary={picked.summary}
            target={picked.target}
            months={picked.months}
            onConfirm={handleConfirm}
            onCancel={() => {
              setClosing(null);
              showToast('Fechamento cancelado. Nenhuma alteração foi feita.', 'info');
            }}
          />,
          document.body,
        )}
    </>
  );
}
