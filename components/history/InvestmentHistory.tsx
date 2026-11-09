'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  assetsHistory,
  assetType,
  HISTORY_RANGES,
  historyRange,
  portfolioHistory,
  typesHistory,
  typesInUse,
  type AssetType,
  type HistoryRange,
  type PriceHistory,
} from '@/lib/diagram';
import { formatBRL } from '@/lib/budget';
import { diagramRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { useDiagram } from '@/components/diagram/useDiagram';
import { TypeChips } from '@/components/diagram/TypeChips';
import { longDate, PortfolioAreaChart, signedBRL, signedPct, Sparkline, trendColor, TypeCompareChart } from './InvestmentCharts';

/**
 * Histórico → Investimentos (only with the Diagrama on). Like the portfolio screens of Kinvo,
 * getquin or Robinhood: the value now and how much it went up or down in the period on top, the
 * line of the period below (green or red), then the same by type and each asset with its own
 * change. It is the portfolio of today at the prices of each day — no purchase price is kept.
 */
export function InvestmentHistory() {
  const { overview, error: overviewError } = useDiagram();
  const [range, setRange] = useState<HistoryRange>('6m');
  const [type, setType] = useState<AssetType | null>(null);
  const [histories, setHistories] = useState<Partial<Record<HistoryRange, PriceHistory>>>({});
  const [error, setError] = useState<string | null>(null);
  const history = histories[range];

  useEffect(() => {
    if (histories[range]) return;
    let active = true;
    void diagramRepository
      .getHistory(range)
      .then((answer) => {
        if (!active) return;
        setHistories((previous) => ({ ...previous, [range]: answer }));
        setError(null);
      })
      .catch((err) => {
        if (active) setError(toStorageErrorMessage(err, 'Não foi possível buscar o histórico agora.'));
      });
    return () => {
      active = false;
    };
  }, [range, histories]);

  const view = useMemo(() => {
    if (!overview || !history) return null;
    const types = typesHistory(overview, history);
    const quoted = types.filter((item) => item.quoted);
    const scope = type && quoted.some((item) => item.type === type) ? type : null;
    return {
      types,
      quoted,
      scope,
      series: portfolioHistory(overview, history, scope),
      assets: assetsHistory(overview, history, scope),
    };
  }, [overview, history, type]);

  const inUse = overview ? typesInUse(overview.settings.targets) : [];
  const hasAssets = !!overview?.assets.some((asset) => inUse.includes(asset.type));
  const phrase = historyRange(range).phrase;
  const missing =
    overview && history ? overview.assets.filter((asset) => inUse.includes(asset.type) && !history.prices[asset.id]) : [];

  return (
    <div className="flex flex-col gap-4 px-4">
      <div className="flex flex-col gap-3" data-tour="historico-investimentos">
        <div role="tablist" aria-label="Período" className="bg-card border-border grid grid-cols-4 gap-1 rounded-xl border p-1">
          {HISTORY_RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={range === option.key}
              onClick={() => setRange(option.key)}
              className={`min-h-[36px] rounded-lg text-sm font-semibold ${
                range === option.key ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {view && view.quoted.length > 1 && (
          <TypeChips
            types={view.quoted.map((item) => item.type)}
            selected={view.scope}
            onSelect={setType}
            all={{ label: 'Carteira toda', onSelect: () => setType(null) }}
          />
        )}

        <section className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
          {overviewError || (error && !history) ? (
            <p className="text-danger text-sm">{overviewError ?? error}</p>
          ) : !overview || (!history && hasAssets) ? (
            <div className="flex flex-col gap-3" aria-busy>
              <div className="bg-background h-4 w-24 animate-pulse rounded" />
              <div className="bg-background h-8 w-40 animate-pulse rounded" />
              <div className="bg-background h-[200px] w-full animate-pulse rounded-xl" />
            </div>
          ) : !hasAssets || !view || view.series.points.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-foreground font-semibold">Nenhum ativo com histórico ainda</p>
              <p className="text-muted text-sm">Adicione seus ativos no Diagrama para ver aqui.</p>
              <Link href="/diagrama?aba=ativos" className="text-primary text-sm font-semibold">
                Abrir o Diagrama
              </Link>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <p className="text-muted text-sm">{view.scope ? assetType(view.scope).label : 'Sua carteira'}</p>
                {view.series.mode === 'value' ? (
                  <p className="text-foreground text-3xl font-semibold tabular-nums">{formatBRL(view.series.end)}</p>
                ) : (
                  <p className="text-3xl font-semibold tabular-nums" style={{ color: trendColor(view.series.end - 1) }}>
                    {signedPct(view.series.end - 1)}
                  </p>
                )}
                <p className="text-sm font-medium tabular-nums" style={{ color: trendColor(view.series.end - view.series.start) }}>
                  {view.series.mode === 'value'
                    ? `${signedBRL(view.series.change)}${view.series.changePct !== null ? ` (${signedPct(view.series.changePct)})` : ''} ${phrase}`
                    : `${phrase}, na média dos seus ativos`}
                </p>
              </div>
              <PortfolioAreaChart
                points={view.series.points}
                mode={view.series.mode}
                range={range}
                start={view.series.start}
                change={view.series.end - view.series.start}
              />
            </>
          )}
        </section>
      </div>

      {view && view.scope === null && view.quoted.length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted text-sm font-semibold">Por tipo</h2>
          <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
            <TypeCompareChart
              range={range}
              dates={history?.dates ?? []}
              lines={view.quoted.map(({ type: key, series }) => ({
                type: key,
                changes: series.points.map((point) => (series.start > 0 ? point.value / series.start - 1 : 0)),
              }))}
            />
            <ul className="divide-border flex flex-col divide-y">
              {view.types.map(({ type: key, series, quoted }) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setType(key)}
                    disabled={!quoted}
                    className="flex min-h-[44px] w-full items-center gap-2 py-2 text-left text-sm"
                  >
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: assetType(key).color }} />
                    <span className="text-foreground min-w-0 flex-1 truncate">{assetType(key).label}</span>
                    {!quoted ? (
                      <span className="text-muted text-xs">Sem cotação, fica parada</span>
                    ) : (
                      <>
                        {series.mode === 'value' && (
                          <span className="text-muted tabular-nums">{signedBRL(series.change)}</span>
                        )}
                        <span
                          className="w-16 text-right font-semibold tabular-nums"
                          style={{ color: trendColor(series.end - series.start) }}
                        >
                          {series.changePct === null ? '—' : signedPct(series.changePct)}
                        </span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {view && view.assets.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted text-sm font-semibold">
            {view.scope ? `Ativos de ${assetType(view.scope).label}` : 'Seus ativos'} {phrase}
          </h2>
          <ul className="border-border bg-card divide-border flex flex-col divide-y rounded-xl border shadow-sm">
            {view.assets.map((item) => (
              <li key={item.asset.id} className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: assetType(item.asset.type).color }} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-foreground text-sm font-semibold">{item.asset.ticker}</span>
                  <span className="text-muted truncate text-xs">
                    {item.since ? `desde ${longDate(item.since)}` : (overview?.quotes[item.asset.id]?.name ?? assetType(item.asset.type).shortLabel)}
                  </span>
                </span>
                <Sparkline prices={item.prices} change={item.changePct} />
                <span className="flex w-20 shrink-0 flex-col items-end">
                  <span className="text-sm font-semibold tabular-nums" style={{ color: trendColor(item.changePct) }}>
                    {signedPct(item.changePct)}
                  </span>
                  {item.asset.quantity > 0 && (
                    <span className="text-muted text-xs tabular-nums">{signedBRL(item.change)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view && view.series.points.length > 0 && (
        <p className="text-muted text-xs">
          {view.series.mode === 'value'
            ? 'Com as cotas de hoje: aportes e vendas antigas não entram.'
            : 'Informe as cotas no Diagrama para ver em reais.'}
          {missing.length > 0 && ` Sem histórico: ${missing.map((asset) => asset.ticker).join(', ')}.`}
        </p>
      )}
    </div>
  );
}
