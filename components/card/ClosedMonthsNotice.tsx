'use client';

import Link from 'next/link';
import { closedMonthsMessage, formatMonthLabel, type Month } from '@/lib/budget';
import { ApiRequestError } from '@/lib/storage/apiClient';

/**
 * Why a purchase could not be saved: one of its months is closed. The app refuses the whole
 * operation — half a series is worse than none — and points at the months, because reopening
 * one is the only way through and the button to do it lives in that month's screen.
 */
export function ClosedMonthsNotice({ months, onNavigate }: { months: Month[]; onNavigate?: () => void }) {
  return (
    <div className="bg-danger-bg text-danger flex flex-col gap-2 rounded-lg px-3 py-2 text-sm">
      <p>{closedMonthsMessage(months)}</p>
      <div className="flex flex-wrap gap-2">
        {months.map((month) => (
          <Link
            key={month}
            href={`/mes/${month}/lancamentos`}
            onClick={onNavigate}
            className="border-danger min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-semibold"
          >
            Abrir {formatMonthLabel(month)}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** The closed months the server named, when it was the reason a write was refused. */
export function closedMonthsOf(err: unknown): Month[] | null {
  if (!(err instanceof ApiRequestError) || err.code !== 'INSTALLMENT_MONTH_CLOSED') return null;
  const months = err.details?.months;
  return Array.isArray(months) && months.every((item) => typeof item === 'string')
    ? (months as Month[])
    : null;
}
