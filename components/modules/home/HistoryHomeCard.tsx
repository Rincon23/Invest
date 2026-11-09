'use client';

import { useEffect, useState } from 'react';
import { computeMonthSummary, formatBRL, formatMonthShort, type Month, type MonthData } from '@/lib/budget';
import { budgetRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { useMonthContext } from '@/components/month/MonthContext';
import { CardNote, HomeCard, Skeleton } from './HomeCard';

const MONTHS = 6;

interface Point {
  month: Month;
  spent: number;
}

/**
 * Histórico: total spent in the last six stored months up to the one on screen. Only those
 * months are read — never the whole history, which is what the Histórico screen does.
 */
export function HistoryHomeCard() {
  const { month } = useMonthContext();
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const keys = (await budgetRepository.listMonths())
          .filter((key) => key <= month)
          .sort()
          .slice(-MONTHS);
        const data = await Promise.all(keys.map((key) => budgetRepository.getMonth(key)));
        if (!active) return;
        setPoints(
          data
            .filter((item): item is MonthData => item !== undefined)
            .map((item) => ({ month: item.month, spent: computeMonthSummary(item).expenseTotal })),
        );
        setError(null);
      } catch (err) {
        if (active) setError(toStorageErrorMessage(err, 'Não foi possível carregar o histórico.'));
      }
    })();
    return () => {
      active = false;
    };
  }, [month]);

  const max = points ? Math.max(0, ...points.map((point) => point.spent)) : 0;
  const average =
    points && points.length > 0 ? points.reduce((total, p) => total + p.spent, 0) / points.length : 0;

  return (
    <HomeCard module="history" href="/historico" title="Histórico">
      {error ? (
        <CardNote tone="danger">{error}</CardNote>
      ) : !points ? (
        <Skeleton className="h-24 w-full" />
      ) : max === 0 ? (
        <CardNote>O gráfico aparece depois do primeiro gasto.</CardNote>
      ) : (
        <>
          <p className="text-muted text-xs">Total gasto por mês · média de {formatBRL(average)}</p>
          <div
            className="flex h-24 items-end gap-2"
            role="img"
            aria-label={`Total gasto nos últimos meses: ${points
              .map((point) => `${formatMonthShort(point.month)} ${formatBRL(point.spent)}`)
              .join(', ')}`}
          >
            {points.map((point) => (
              <div
                key={point.month}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              >
                <div
                  className={`w-full max-w-10 rounded-t-md ${point.month === month ? 'bg-series-5' : 'bg-series-5/35'}`}
                  style={{ height: `${max > 0 ? Math.max((point.spent / max) * 100, 4) : 4}%` }}
                />
                <span className="text-muted text-[10px] leading-none">
                  {formatMonthShort(point.month).slice(0, 3)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </HomeCard>
  );
}
