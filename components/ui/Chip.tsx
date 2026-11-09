'use client';

export function Chip({
  label,
  selected,
  onClick,
  tourAnchor,
  badge,
  badgeTone = 'warning',
  dotColor,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  /** A dot of this colour before the label, e.g. a tag's colour. */
  dotColor?: string;
  /** `data-tour` anchor, when a tour points at this chip. */
  tourAnchor?: string;
  /** A small tag inside the chip, e.g. "Não recomendado" on "Fora do orçamento". */
  badge?: string;
  /** Whether the tag is a warning ("Não recomendado") or an endorsement ("Recomendado"). */
  badgeTone?: 'warning' | 'success';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-tour={tourAnchor}
      className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:border-primary/50'
      }`}
    >
      {dotColor && (
        <span
          aria-hidden
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${selected ? 'ring-primary-foreground ring-2' : ''}`}
          style={{ background: dotColor }}
        />
      )}
      {label}
      {badge && (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            selected
              ? 'bg-primary-foreground/20 text-primary-foreground'
              : badgeTone === 'success'
                ? 'bg-success-bg text-success'
                : 'bg-warning-bg text-warning'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
