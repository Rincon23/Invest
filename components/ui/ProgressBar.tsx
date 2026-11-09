import type { ProgressState } from '@/lib/budget';

const STATE_CLASSES: Record<ProgressState, string> = {
  ok: 'bg-success-fill',
  warning: 'bg-warning-fill',
  danger: 'bg-danger-fill',
};

export function ProgressBar({
  usedPct,
  state,
  color,
}: {
  usedPct: number | null;
  state: ProgressState;
  /** When given, fills the bar with this color instead of the status color (e.g. a topic's own color). */
  color?: string;
}) {
  const pct = usedPct === null ? 100 : Math.min(Math.max(usedPct * 100, 0), 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={usedPct === null ? undefined : Math.round(usedPct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="bg-border h-2 w-full overflow-hidden rounded-full"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${color ? '' : STATE_CLASSES[state]}`}
        style={{ width: `${pct}%`, ...(color ? { backgroundColor: color } : {}) }}
      />
    </div>
  );
}
