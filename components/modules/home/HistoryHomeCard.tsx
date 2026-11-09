'use client';

import { useEffect, useState } from 'react';
import { formatBRL } from '@/lib/core';
import { portfolioHistory, type HistorySeries } from '@/lib/diagram';
import { diagramRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { signedPct, Sparkline, trendColor } from '@/components/history/InvestmentCharts';
import { CardNote, HomeCard, Skeleton } from './HomeCard';

/** Histórico: how the portfolio of today went in the last month, with its line. */
export function HistoryHomeCard() {
  const [series, setSeries] = useState<HistorySeries | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [overview, history] = await Promise.all([
          diagramRepository.getOverview(),
          diagramRepository.getHistory('1m'),
        ]);
        if (!active) return;
        setSeries(portfolioHistory(overview, history));
        setError(null);
      } catch (err) {
        if (active) setError(toStorageErrorMessage(err, 'Não foi possível carregar o histórico.'));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <HomeCard module="history" href="/historico" title="Histórico">
      {error ? (
        <CardNote tone="danger">{error}</CardNote>
      ) : !series ? (
        <Skeleton className="h-12 w-full" />
      ) : series.points.length < 2 ? (
        <CardNote>O gráfico aparece depois do primeiro ativo no Diagrama.</CardNote>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted text-xs">No último mês</p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: trendColor(series.changePct ?? 0) }}>
              {series.changePct === null ? '—' : signedPct(series.changePct)}
            </p>
            {series.mode === 'value' && (
              <p className="text-muted text-xs tabular-nums">Carteira hoje: {formatBRL(series.end)}</p>
            )}
          </div>
          <Sparkline prices={series.points.map((point) => point.value)} change={series.changePct ?? 0} />
        </div>
      )}
    </HomeCard>
  );
}
