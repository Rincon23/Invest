'use client';

import { useEffect, useState } from 'react';
import { connectionHealth, formatAgo } from '@/lib/banks';
import { banksRepository, type BanksOverviewResult } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { CardNote, HomeCard, Skeleton } from './HomeCard';

const SHOWN_BANKS = 3;

/** Open Finance: the brokers brought in and when each last sent data. */
export function BanksHomeCard() {
  const [overview, setOverview] = useState<BanksOverviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

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
          {overview.key
            ? 'Nenhuma corretora ainda. Toque para trazer a primeira.'
            : 'Toque para conectar suas corretoras.'}
        </CardNote>
      ) : (
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
      )}
    </HomeCard>
  );
}
