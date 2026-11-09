'use client';

interface PercentInputProps {
  /** Fraction 0..1 (e.g. 0.2 for 20%). */
  value: number;
  /** Fraction 0..1. */
  onChange: (value: number) => void;
  ariaLabel: string;
  /** Percentage points per arrow click. Defaults to 1. */
  step?: number;
}

/** Percentage input with up/down stepper buttons, since native number spinners are hidden app-wide. */
export function PercentInput({ value, onChange, ariaLabel, step = 1 }: PercentInputProps) {
  const displayValue = Math.round(value * 1000) / 10;

  function setFromPct(pct: number) {
    const clamped = Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
    onChange(clamped / 100);
  }

  return (
    <div className="border-border bg-background focus-within:ring-primary flex shrink-0 items-stretch overflow-hidden rounded-md border focus-within:ring-2">
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={displayValue}
        onChange={(e) => setFromPct(Number(e.target.value))}
        className="text-foreground min-h-[40px] w-14 border-0 bg-transparent px-2 text-right outline-none"
        aria-label={ariaLabel}
      />
      <div className="border-border flex flex-col border-l">
        <button
          type="button"
          onClick={() => setFromPct(displayValue + step)}
          aria-label={`Aumentar ${ariaLabel}`}
          className="text-muted hover:text-foreground hover:bg-card flex min-h-[20px] min-w-[22px] flex-1 items-center justify-center text-[9px] leading-none"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => setFromPct(displayValue - step)}
          aria-label={`Diminuir ${ariaLabel}`}
          className="border-border text-muted hover:text-foreground hover:bg-card flex min-h-[20px] min-w-[22px] flex-1 items-center justify-center border-t text-[9px] leading-none"
        >
          ▼
        </button>
      </div>
    </div>
  );
}
