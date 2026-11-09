'use client';

import { useId } from 'react';
import type { TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBRL } from '@/lib/budget';
import { assetType, type AssetType, type HistoryMode, type HistoryPoint, type HistoryRange } from '@/lib/diagram';

const AXIS_TICK = { fill: 'var(--color-muted-foreground)', fontSize: 11 };
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "+5,2%" / "−3,1%". */
export function signedPct(ratio: number): string {
  const text = `${Math.abs(ratio * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (Math.abs(ratio) < 0.0005) return '0,0%';
  return `${ratio > 0 ? '+' : '−'}${text}`;
}

/** "+R$ 1.234,56" / "−R$ 80,00". */
export function signedBRL(value: number): string {
  if (Math.abs(value) < 0.005) return formatBRL(0);
  return `${value > 0 ? '+' : '−'}${formatBRL(Math.abs(value))}`;
}

/** The colour of a change: up is green, down is red. */
export function trendColor(change: number): string {
  if (change > 0) return 'var(--color-success)';
  if (change < 0) return 'var(--color-danger)';
  return 'var(--color-muted)';
}

/** "17/10" in a month, "out/26" in a year, "2023" in five. */
export function axisDate(range: HistoryRange, date: string): string {
  const [year, month, day] = date.split('-');
  if (range === '1m') return `${day}/${month}`;
  if (range === '5a') return year;
  return `${MONTHS[Number(month) - 1]}/${year.slice(2)}`;
}

/** "17/10/2026". */
export function longDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function PortfolioTooltip({
  active,
  payload,
  mode,
  start,
}: TooltipContentProps<ValueType, NameType> & { mode: HistoryMode; start: number }) {
  const point = payload?.[0]?.payload as HistoryPoint | undefined;
  if (!active || !point) return null;
  const change = start > 0 ? point.value / start - 1 : 0;
  return (
    <div className="border-border bg-card rounded-lg border px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{longDate(point.date)}</p>
      {mode === 'value' && <p className="text-foreground text-sm font-semibold tabular-nums">{formatBRL(point.value)}</p>}
      <p className="font-medium tabular-nums" style={{ color: trendColor(change) }}>
        {signedPct(change)} desde o início
      </p>
    </div>
  );
}

/**
 * The portfolio (or one type) across the period, green when it ended up and red when down, with
 * the starting value as a dashed line. Dragging a finger over it shows each day.
 */
export function PortfolioAreaChart({
  points,
  mode,
  range,
  start,
  change,
}: {
  points: HistoryPoint[];
  mode: HistoryMode;
  range: HistoryRange;
  start: number;
  change: number;
}) {
  const gradient = useId().replace(/:/g, '');
  const color = trendColor(change);
  return (
    <div className="h-[200px] w-full" data-no-swipe-nav>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={(date: string) => axisDate(range, date)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={36}
          />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <ReferenceLine y={start} stroke="var(--color-border)" strokeDasharray="4 4" />
          <Tooltip
            content={(props) => <PortfolioTooltip {...props} mode={mode} start={start} />}
            cursor={{ stroke: 'var(--color-muted)', strokeDasharray: '3 3' }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradient})`}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface TypeLine {
  type: AssetType;
  /** Change since the start of the period, per date (0..1 ratios). */
  changes: number[];
}

function CompareTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="border-border bg-card rounded-lg border px-3 py-2 text-xs shadow-lg">
      <p className="text-muted mb-1">{longDate(String(label))}</p>
      {[...payload]
        .sort((a, b) => Number(b.value) - Number(a.value))
        .map((entry) => (
          <p key={String(entry.dataKey)} className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-muted">{entry.name}</span>
            <span className="text-foreground ml-auto font-medium tabular-nums">{signedPct(Number(entry.value))}</span>
          </p>
        ))}
    </div>
  );
}

/** Every type as the % it went up or down since the start of the period, on the same scale. */
export function TypeCompareChart({ dates, lines, range }: { dates: string[]; lines: TypeLine[]; range: HistoryRange }) {
  const data = dates.map((date, index) => {
    const row: Record<string, string | number> = { date };
    for (const line of lines) row[line.type] = line.changes[index] ?? 0;
    return row;
  });
  return (
    <div className="h-[180px] w-full" data-no-swipe-nav>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(date: string) => axisDate(range, date)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={36}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
          />
          <ReferenceLine y={0} stroke="var(--color-border)" />
          <Tooltip content={(props) => <CompareTooltip {...props} />} cursor={{ stroke: 'var(--color-muted)', strokeDasharray: '3 3' }} />
          {lines.map((line) => (
            <Line
              key={line.type}
              type="monotone"
              dataKey={line.type}
              name={assetType(line.type).shortLabel}
              stroke={assetType(line.type).color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A tiny line of an asset's prices, coloured by how it ended. */
export function Sparkline({ prices, change }: { prices: number[]; change: number }) {
  if (prices.length < 2) return <span className="h-6 w-16" />;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const step = 64 / (prices.length - 1);
  const path = prices.map((price, index) => `${(index * step).toFixed(1)},${(22 - ((price - min) / span) * 20).toFixed(1)}`);
  return (
    <svg viewBox="0 0 64 24" className="h-6 w-16 shrink-0" aria-hidden>
      <polyline points={path.join(' ')} fill="none" stroke={trendColor(change)} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
