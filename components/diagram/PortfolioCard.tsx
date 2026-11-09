'use client';

import { formatBRL } from '@/lib/budget';
import { assetType, portfolioByType, type DiagramOverview } from '@/lib/diagram';
import { Donut } from './Donut';
import { pct } from './format';

/**
 * The portfolio by type: the donut is today, and the legend says today and the target of each
 * type. The same picture on both tabs and, smaller, on the Início.
 */
export function PortfolioChart({ overview, compact = false }: { overview: DiagramOverview; compact?: boolean }) {
  const { total, slices } = portfolioByType(overview);
  if (slices.length === 0) {
    return <p className="text-muted text-sm">Nenhum tipo na carteira ainda. Escolha os tipos e as metas na engrenagem.</p>;
  }
  return (
    <div className="flex items-center gap-4">
      <Donut
        label="Carteira por tipo, hoje"
        slices={slices.map((slice) => ({ key: slice.type, value: slice.value, color: assetType(slice.type).color }))}
        size={compact ? 104 : 128}
      >
        <span className="text-muted text-[10px]">Carteira</span>
        <span className="text-foreground text-xs font-semibold tabular-nums">{formatBRL(total)}</span>
      </Donut>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        <li className="text-muted flex justify-end gap-3 text-[10px] font-semibold tracking-wide uppercase">
          <span className="w-11 text-right">Hoje</span>
          <span className="w-11 text-right">Meta</span>
        </li>
        {slices.map((slice) => {
          const type = assetType(slice.type);
          const far = slice.target > 0 && Math.abs(slice.share - slice.target) >= 0.05;
          return (
            <li key={slice.type} className="flex items-center gap-2 text-xs">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: type.color }} />
              <span className="text-foreground min-w-0 flex-1 truncate">{compact ? type.shortLabel : type.label}</span>
              <span className={`w-11 text-right tabular-nums ${far ? 'text-warning font-semibold' : 'text-foreground'}`}>
                {total > 0 ? pct(slice.share) : '—'}
              </span>
              <span className="text-muted w-11 text-right tabular-nums">{pct(slice.target)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
