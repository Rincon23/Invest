import type { LucideIcon } from 'lucide-react';

/** Accent hues for icon tiles, from the chart palette so they work in light and dark themes. */
export type IconTone = 'blue' | 'orange' | 'green' | 'amber' | 'pink' | 'purple' | 'red' | 'neutral';

const TONES: Record<IconTone, string> = {
  blue: 'bg-series-1/15 text-series-1',
  orange: 'bg-series-2/15 text-series-2',
  green: 'bg-series-3/15 text-series-3',
  amber: 'bg-series-4/15 text-series-4',
  pink: 'bg-series-5/15 text-series-5',
  purple: 'bg-series-7/15 text-series-7',
  red: 'bg-series-8/15 text-series-8',
  neutral: 'bg-border/70 text-foreground',
};

const SIZES = {
  sm: { box: 'h-8 w-8 rounded-lg', icon: 'h-4 w-4' },
  md: { box: 'h-10 w-10 rounded-xl', icon: 'h-5 w-5' },
  lg: { box: 'h-12 w-12 rounded-2xl', icon: 'h-6 w-6' },
} as const;

/** An icon on a soft tinted square — how every area and menu entry is identified at a glance. */
export function IconTile({
  icon: Icon,
  tone,
  size = 'md',
}: {
  icon: LucideIcon;
  tone: IconTone;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center ${SIZES[size].box} ${TONES[tone]}`}
    >
      <Icon className={SIZES[size].icon} strokeWidth={2} />
    </span>
  );
}
