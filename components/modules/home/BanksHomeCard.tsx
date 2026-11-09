'use client';

import { useEffect, useState } from 'react';
import { useSettings } from '@/components/providers/SettingsProvider';
import { connectionHealth, formatAgo, type BankReviewCounts } from '@/lib/banks';
import { formatMonthName } from '@/lib/budget/date';
import { isModuleOn } from '@/lib/modules';
import { banksRepository, type BanksOverviewResult } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { CardNote, HomeCard, Skeleton } from './HomeCard';

const SHOWN_BANKS = 3;

/** Open Finance: the banks brought in, when each last sent data, and what this month still asks. */
export function BanksHomeCard() {
  const { settings } = useSettings();
  const [overview, setOverview] = useState<BanksOverviewResult | null>(null);
  const [counts, setCounts] = useState<BankReviewCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const expensesOn = isModuleOn(settings, 'expenses');
  const hasBanks = (overview?.connections.length ?? 0) > 0;

  useEffect(() => {
    let active = true;
    banksRepository
      .getOverview()
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch((err: unknown) => {
        if (active) setError(toStorageErrorMessage(err, 'Não foi possível carregar os bancos.'));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!expensesOn || !hasBanks) return;
    let active = true;
    banksRepository
      .getReviewCounts()
      .then((next) => {
        if (active) setCounts(next);
      })
      // The banks still show without it.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [expensesOn, hasBanks]);

  const missing = counts ? counts.expenses + counts.incomes : 0;

  return (
    <HomeCard module="banks" href="/bancos">
      {error ? (
        <CardNote tone="danger">{error}</CardNote>
      ) : !overview ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : overview.connections.length === 0 ? (
        <CardNote>
          {overview.key ? 'Nenhum banco ainda. Toque para trazer o primeiro.' : 'Toque para conectar seus bancos.'}
        </CardNote>
      ) : (
        <>
          {counts && (
            <p className={`text-sm font-medium ${missing > 0 ? 'text-foreground' : 'text-success'}`}>
              {missing > 0
                ? `${missing} para conferir em ${formatMonthName(counts.month).toLowerCase()}`
                : `${formatMonthName(counts.month)} confere ✓`}
            </p>
          )}
          <ul className="divide-border flex flex-col divide-y">
            {overview.connections.slice(0, SHOWN_BANKS).map((connection) => {
              const health = connectionHealth(connection, now);
              return (
                <li key={connection.itemId} className="flex items-baseline justify-between gap-2 py-1.5 text-sm">
                  <span className="text-foreground truncate">{connection.name}</span>
                  <span
                    className={`shrink-0 text-xs ${health === 'ok' || health === 'pending' ? 'text-muted' : 'text-warning'}`}
                  >
                    {health === 'pending'
                      ? 'chegando…'
                      : health === 'ok'
                        ? connection.lastUpdatedAt
                          ? formatAgo(connection.lastUpdatedAt, now)
                          : '—'
                        : health === 'stale'
                          ? 'parado'
                          : health === 'error'
                            ? 'falhou'
                            : 'reconectar'}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </HomeCard>
  );
}
