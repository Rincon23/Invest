'use client';

import { useEffect, useRef } from 'react';

export interface MonthBar {
  key: string;
  /** Under the bar: "out". */
  label: string;
  value: number;
  /** A dashed mark across the bar: the income of the month, or the category's limit. */
  marker?: number | null;
}

/**
 * One bar per month, each one a button: touching a bar picks that month (the hero and the list
 * follow it). Below zero, the bar goes down (a negative "sobra"). With many months it scrolls
 * sideways and starts at the newest.
 */
export function MonthBars({
  bars,
  selected,
  onSelect,
  color,
  negativeColor = 'var(--color-danger-fill)',
  describe,
  height = 132,
}: {
  bars: MonthBar[];
  selected: string | null;
  onSelect: (key: string) => void;
  color: string;
  negativeColor?: string;
  /** What a screen reader hears for each bar. */
  describe: (bar: MonthBar) => string;
  height?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const box = scroller.current;
    const bar = selectedRef.current;
    if (!box || !bar) return;
    // Brings the chosen month into view without moving the page.
    const left = bar.offsetLeft - box.clientWidth / 2 + bar.clientWidth / 2;
    box.scrollTo({ left: Math.max(0, left) });
  }, [selected, bars.length]);

  const values = bars.flatMap((bar) => [bar.value, bar.marker ?? 0]);
  // A little room on top, so the dashed mark of the highest month still shows.
  const max = Math.max(0, ...values) * 1.06;
  const min = Math.min(0, ...bars.map((bar) => bar.value));
  const span = max - min || 1;
  const zero = (-min / span) * 100;
  const at = (value: number) => ((value - min) / span) * 100;

  return (
    <div ref={scroller} className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]" data-no-swipe-nav>
      <div className="flex min-w-full gap-1.5" style={{ width: bars.length > 12 ? `${bars.length * 34}px` : undefined }}>
        {bars.map((bar) => {
          const on = bar.key === selected;
          const negative = bar.value < 0;
          return (
            <button
              key={bar.key}
              ref={on ? selectedRef : undefined}
              type="button"
              onClick={() => onSelect(bar.key)}
              aria-pressed={on}
              aria-label={describe(bar)}
              className="flex min-w-[28px] flex-1 flex-col items-center gap-1"
            >
              <span className="relative w-full" style={{ height }}>
                <span
                  aria-hidden
                  className={`absolute inset-x-[15%] rounded-[4px] transition-opacity ${on ? 'opacity-100' : 'opacity-35'}`}
                  style={{
                    background: negative ? negativeColor : color,
                    bottom: negative ? `${at(bar.value)}%` : `${zero}%`,
                    height: `${Math.max((Math.abs(bar.value) / span) * 100, bar.value === 0 ? 0 : 2)}%`,
                  }}
                />
                {bar.marker != null && bar.marker > 0 && (
                  <span
                    aria-hidden
                    className="border-foreground/60 absolute inset-x-0 border-t-2 border-dashed"
                    style={{ bottom: `${at(bar.marker)}%` }}
                  />
                )}
                {min < 0 && (
                  <span aria-hidden className="bg-border absolute inset-x-0 h-px" style={{ bottom: `${zero}%` }} />
                )}
              </span>
              <span className={`text-[11px] leading-none ${on ? 'text-foreground font-semibold' : 'text-muted'}`}>
                {bar.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
