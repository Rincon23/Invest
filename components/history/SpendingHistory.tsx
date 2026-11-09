'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  computeProgressState,
  currentMonthKey,
  formatBRL,
  formatMonthLabel,
  formatMonthShort,
  formatPct,
  type MonthSummary,
} from '@/lib/budget';
import { useAllMonths } from '@/lib/hooks/useAllMonths';
import { useSettings } from '@/components/providers/SettingsProvider';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { MonthBars, type MonthBar } from './MonthBars';

type Period = '6' | '12' | 'all';

const PERIODS: { key: Period; label: string }[] = [
  { key: '6', label: '6 meses' },
  { key: '12', label: '12 meses' },
  { key: 'all', label: 'Tudo' },
];

type TrendMode = 'spent' | 'remaining';

interface TopicOption {
  id: string;
  name: string;
  color: string;
}

/** "out" under a bar; January also says the year, so a long history still reads. */
function barLabel(month: string): string {
  const short = formatMonthShort(month);
  return month.endsWith('-01') ? short : short.slice(0, 3);
}

/** "outubro" for a sentence. */
function monthName(month: string): string {
  return formatMonthLabel(month).split(' ')[0].toLowerCase();
}

/**
 * Histórico → Gastos. Inspired by the "spending over time" of Monarch and Mobills: one month at a
 * time on top (how much went out, against the person's own average), its bars to pick another
 * month, the categories of that month, and one category at a time across the months.
 */
export function SpendingHistory() {
  const { settings } = useSettings();
  const { summaries, loading, error } = useAllMonths(settings?.topics);
  const [period, setPeriod] = useState<Period>('12');
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const [chosenTopic, setChosenTopic] = useState<string | null>(null);
  const [mode, setMode] = useState<TrendMode>('spent');

  const visible = useMemo(
    () => (period === 'all' ? summaries : summaries.slice(-Number(period))),
    [summaries, period],
  );
  const selected: MonthSummary | undefined =
    visible.find((summary) => summary.month === chosenMonth) ?? visible.at(-1);
  const selectedIndex = selected ? visible.indexOf(selected) : -1;

  const topics: TopicOption[] = useMemo(() => {
    const byId = new Map<string, TopicOption>();
    for (const summary of visible) {
      for (const topic of summary.topics) byId.set(topic.topicId, { id: topic.topicId, name: topic.name, color: topic.color });
    }
    return [...byId.values()];
  }, [visible]);
  const trendTopic = topics.find((topic) => topic.id === chosenTopic) ?? topics[0];

  if (loading) {
    return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
  }
  if (error) return <p className="text-danger px-4 text-sm">{error}</p>;

  // Without any month yet, the sections are still there (empty), so the tour can show them.
  if (!selected) {
    const empty = (text: string) => (
      <div className="border-border bg-card text-muted rounded-xl border p-4 text-sm shadow-sm">{text}</div>
    );
    return (
      <div className="flex flex-col gap-6">
        <section className="px-4" data-tour="historico-mes">
          {empty('Seus gastos aparecem aqui depois do primeiro lançamento.')}
        </section>
        <section className="flex flex-col gap-2 px-4" data-tour="historico-categorias">
          <h2 className="text-muted text-sm font-semibold">Categorias do mês</h2>
          {empty('Quanto você gastou do limite de cada categoria.')}
        </section>
        <section className="flex flex-col gap-2 px-4" data-tour="historico-evolucao">
          <h2 className="text-muted text-sm font-semibold">Cada categoria mês a mês</h2>
          {empty('Nenhum mês registrado ainda.')}
        </section>
      </div>
    );
  }

  const current = currentMonthKey();
  const inProgress = selected.month === current;
  const others = visible.filter((summary) => summary.month !== selected.month && summary.month !== current);
  const average = others.length > 0 ? others.reduce((total, s) => total + s.expenseTotal, 0) / others.length : null;
  const difference = average === null ? null : selected.expenseTotal - average;

  const pick = (month: string) => setChosenMonth(month);
  const step = (delta: number) => {
    const next = visible[selectedIndex + delta];
    if (next) setChosenMonth(next.month);
  };

  const monthBars: MonthBar[] = visible.map((summary) => ({
    key: summary.month,
    label: barLabel(summary.month),
    value: summary.expenseTotal,
    marker: summary.incomeTotal,
  }));

  const trendBars: MonthBar[] = trendTopic
    ? visible.map((summary) => {
        const topic = summary.topics.find((item) => item.topicId === trendTopic.id);
        return {
          key: summary.month,
          label: barLabel(summary.month),
          value: topic ? (mode === 'spent' ? topic.spent : topic.remaining) : 0,
          marker: mode === 'spent' ? (topic?.available ?? null) : null,
        };
      })
    : [];
  const trendWithData = trendBars.filter((bar) => bar.value !== 0);
  const trendAverage =
    trendWithData.length > 0 ? trendWithData.reduce((total, bar) => total + bar.value, 0) / trendWithData.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {summaries.length > 6 && (
          <div className="flex gap-2 px-4" data-no-swipe-nav>
            {PERIODS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={period === option.key}
                onClick={() => setPeriod(option.key)}
                className={`min-h-[36px] rounded-full border px-3 text-sm font-medium ${
                  period === option.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <section
          className="border-border bg-card mx-4 flex flex-col gap-4 rounded-2xl border p-4 shadow-sm"
          data-tour="historico-mes"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={selectedIndex <= 0}
              aria-label="Mês anterior"
              className="text-foreground hover:bg-background flex h-9 w-9 items-center justify-center rounded-full text-xl disabled:opacity-30"
            >
              ‹
            </button>
            <span className="text-foreground text-sm font-semibold">{formatMonthLabel(selected.month)}</span>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={selectedIndex >= visible.length - 1}
              aria-label="Próximo mês"
              className="text-foreground hover:bg-background flex h-9 w-9 items-center justify-center rounded-full text-xl disabled:opacity-30"
            >
              ›
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-muted text-sm">{inProgress ? 'Você gastou até agora' : 'Você gastou'}</p>
            <p className="text-foreground text-3xl font-semibold tabular-nums">{formatBRL(selected.expenseTotal)}</p>
            {difference !== null && Math.abs(difference) >= 0.5 && (
              <p className={`text-sm font-medium ${difference < 0 ? 'text-success' : 'text-warning'}`}>
                {formatBRL(Math.abs(difference))} {difference < 0 ? 'a menos' : 'a mais'} que a sua média
              </p>
            )}
            {selected.incomeTotal > 0 && (
              <p className="text-muted text-xs">
                {formatPct(selected.expenseTotal / selected.incomeTotal, 0)} da renda de {formatBRL(selected.incomeTotal)}
              </p>
            )}
          </div>

          <MonthBars
            bars={monthBars}
            selected={selected.month}
            onSelect={pick}
            color="var(--color-series-5)"
            describe={(bar) =>
              `${formatMonthLabel(bar.key)}: gasto ${formatBRL(bar.value)}${bar.marker ? `, renda ${formatBRL(bar.marker)}` : ''}`
            }
          />
          <Legend items={[{ label: 'Gasto', color: 'var(--color-series-5)' }, { label: 'Renda', dashed: true }]} />
        </section>
      </div>

      <section className="flex flex-col gap-2 px-4" data-tour="historico-categorias">
        <h2 className="text-muted text-sm font-semibold">Categorias em {monthName(selected.month)}</h2>
        <div className="border-border bg-card divide-border flex flex-col divide-y rounded-xl border shadow-sm">
          {selected.topics.map((topic) => {
            const usedPct = topic.usedPct ?? (topic.spent > 0 ? null : 0);
            const state = computeProgressState(usedPct);
            return (
              <Link
                key={`${selected.month}-${topic.topicId}`}
                href={`/mes/${selected.month}/categoria/${topic.topicId}`}
                className="hover:bg-background flex flex-col gap-2 px-4 py-3 first:rounded-t-xl last:rounded-b-xl"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: topic.color }} />
                    <span className="text-foreground truncate text-sm font-semibold">{topic.name}</span>
                  </span>
                  <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
                    {formatBRL(topic.spent)}
                  </span>
                </span>
                <ProgressBar usedPct={usedPct} state={state} color={topic.color} />
                <span className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted">Limite {formatBRL(topic.available)}</span>
                  <span className={topic.remaining < 0 ? 'text-danger font-medium' : 'text-muted'}>
                    {topic.remaining < 0
                      ? `Passou ${formatBRL(-topic.remaining)}`
                      : `Sobra ${formatBRL(topic.remaining)}`}
                  </span>
                </span>
              </Link>
            );
          })}
          {selected.topics.length === 0 && <p className="text-muted px-4 py-3 text-sm">Nenhuma categoria neste mês.</p>}
        </div>
      </section>

      <section className="flex flex-col gap-2 px-4" data-tour="historico-evolucao">
        <h2 className="text-muted text-sm font-semibold">Cada categoria mês a mês</h2>
        <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
          <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4" data-no-swipe-nav>
            {topics.map((topic) => {
              const on = topic.id === trendTopic?.id;
              return (
                <button
                  key={topic.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChosenTopic(topic.id)}
                  className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${
                    on ? 'text-foreground' : 'border-border text-muted'
                  }`}
                  style={
                    on
                      ? { borderColor: topic.color, background: `color-mix(in srgb, ${topic.color} 16%, transparent)` }
                      : undefined
                  }
                >
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: topic.color }} />
                  {topic.name}
                </button>
              );
            })}
          </div>

          <div role="tablist" className="bg-background grid grid-cols-2 gap-1 rounded-lg p-1">
            {(
              [
                ['spent', 'Gasto'],
                ['remaining', 'Sobra'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={`min-h-[34px] rounded-md text-sm font-medium ${
                  mode === key ? 'bg-card text-foreground shadow-sm' : 'text-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {trendTopic && (
            <>
              <MonthBars
                bars={trendBars}
                selected={selected.month}
                onSelect={pick}
                color={trendTopic.color}
                describe={(bar) =>
                  `${formatMonthLabel(bar.key)}: ${mode === 'spent' ? 'gasto' : 'sobra'} ${formatBRL(bar.value)}${
                    bar.marker ? `, limite ${formatBRL(bar.marker)}` : ''
                  }`
                }
              />
              {mode === 'spent' ? (
                <Legend items={[{ label: 'Gasto', color: trendTopic.color }, { label: 'Limite', dashed: true }]} />
              ) : null}
              <p className="text-muted text-xs">
                {mode === 'spent'
                  ? `Média de ${formatBRL(trendAverage)} por mês em ${trendTopic.name}.`
                  : 'O que sobrou em cada mês, com o do mês anterior.'}
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color?: string; dashed?: boolean }[] }) {
  return (
    <div className="text-muted flex flex-wrap gap-4 text-xs">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {item.dashed ? (
            <span aria-hidden className="border-foreground/60 w-4 border-t-2 border-dashed" />
          ) : (
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}
