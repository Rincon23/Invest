'use client';

import type { ReactNode } from 'react';

export interface DonutSlice {
  key: string;
  value: number;
  /** A CSS colour (e.g. `var(--series-1)`). */
  color: string;
}

/** One ring of the donut: slices clockwise from the top, a hairline gap between them. */
function Ring({ slices, radius, width }: { slices: DonutSlice[]; radius: number; width: number }) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const circumference = 2 * Math.PI * radius;
  const visible = slices.filter((slice) => slice.value > 0);
  const gap = visible.length > 1 ? 1.5 : 0;
  let offset = 0;
  return (
    <g transform="rotate(-90 60 60)">
      <circle cx={60} cy={60} r={radius} fill="none" stroke="var(--border)" strokeWidth={width} opacity={0.6} />
      {total > 0 &&
        visible.map((slice) => {
          const length = (slice.value / total) * circumference;
          const dash = Math.max(0, length - gap);
          const element = (
            <circle
              key={slice.key}
              cx={60}
              cy={60}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={width}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return element;
        })}
    </g>
  );
}

/** A donut drawn with plain SVG (it follows the theme's colours), with a label in the middle. */
export function Donut({
  slices,
  size = 132,
  label,
  children,
}: {
  slices: DonutSlice[];
  size?: number;
  /** Accessible description of what the chart shows. */
  label: string;
  /** Shown in the middle. */
  children?: ReactNode;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={label}>
        <Ring slices={slices} radius={52} width={13} />
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">
          {children}
        </div>
      )}
    </div>
  );
}
