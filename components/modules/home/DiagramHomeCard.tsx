'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';
import { formatBRL } from '@/lib/budget';
import { assetType, portfolioByType, type DiagramOverview } from '@/lib/diagram';
import { diagramRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { IconTile } from '@/components/ui/IconTile';
import { formatDate, pct } from '@/components/diagram/format';
import { PortfolioChart } from '@/components/diagram/PortfolioCard';
import { MODULE_VISUALS } from '../visuals';
import { CardNote, Skeleton } from './HomeCard';

/** Below this many percentage points, a type counts as on its target. */
const ON_TARGET = 0.005;

/**
 * Diagrama on the Início: the portfolio by type (today and target), the type furthest below its
 * target — where the next aporte will go first — the last aporte, and "Novo aporte".
 */
export function DiagramHomeCard() {
  const [overview, setOverview] = useState<DiagramOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visual = MODULE_VISUALS.diagram;

  useEffect(() => {
    let active = true;
    diagramRepository
      .getOverview()
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch((err: unknown) => {
        if (active) setError(toStorageErrorMessage(err, 'Não foi possível carregar o Diagrama.'));
      });
    return () => {
      active = false;
    };
  }, []);

  const slices = overview ? portfolioByType(overview).slices : [];
  const furthest = slices
    .filter((slice) => slice.target > 0)
    .reduce<(typeof slices)[number] | null>(
      (worst, slice) => (!worst || slice.share - slice.target < worst.share - worst.target ? slice : worst),
      null,
    );
  const last = overview?.contributions[0];

  return (
    <section
      className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm"
      data-tour="card-diagram"
    >
      <Link href="/diagrama" className="flex items-center gap-3">
        <IconTile icon={visual.icon} tone={visual.tone} />
        <p className="text-foreground min-w-0 flex-1 truncate font-semibold">Diagrama</p>
        <ChevronRight aria-hidden className="text-muted h-4 w-4 shrink-0" />
      </Link>
      {error ? (
        <CardNote tone="danger">{error}</CardNote>
      ) : !overview ? (
        <div className="flex items-center gap-4">
          <Skeleton className="h-[104px] w-[104px] rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ) : (
        <>
          <Link href="/diagrama" className="block">
            <PortfolioChart overview={overview} compact />
          </Link>
          {furthest && (
            <p className="bg-background text-muted rounded-xl px-3 py-2 text-xs">
              {furthest.target - furthest.share > ON_TARGET ? (
                <>
                  Mais abaixo da meta:{' '}
                  <span className="text-foreground font-semibold">{assetType(furthest.type).label}</span> (
                  {pct(furthest.share)} de {pct(furthest.target)})
                </>
              ) : (
                'Todos os tipos estão na meta.'
              )}
              {last ? ` · Último aporte: ${formatBRL(last.amount)} em ${formatDate(last.date).slice(0, 5)}` : ''}
            </p>
          )}
        </>
      )}
      <Link
        href="/diagrama?aba=aporte"
        className="bg-primary text-primary-foreground flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
      >
        <Plus aria-hidden className="h-4 w-4" />
        Novo aporte
      </Link>
    </section>
  );
}
