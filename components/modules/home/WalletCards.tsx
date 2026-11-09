'use client';

import {
  currentMonthKey,
  formatBRL,
  formatDayMonth,
  formatMonthShort,
  openBills,
  recurringChecklist,
} from '@/lib/budget';
import { useWallet } from '@/components/wallet/WalletProvider';
import { CardNote, HomeCard, HomeTile, Skeleton, Stat } from './HomeCard';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Contas do mês: what is still to launch this month, and how many bills that is. */
export function RecurringHomeTile() {
  const { snapshot, error } = useWallet();
  const checklist = snapshot
    ? recurringChecklist(snapshot.recurring, snapshot.recurringLaunches, currentMonthKey(), snapshot.today)
    : null;
  const late = checklist
    ? checklist.pending.filter((status) => status.daysUntilDue !== null && status.daysUntilDue < 0).length
    : 0;
  return (
    <HomeTile
      module="recurring"
      href="/carteira/recorrentes"
      value={
        checklist
          ? snapshot && snapshot.recurring.length > 0 && checklist.pending.length === 0
            ? 'Tudo lançado'
            : formatBRL(checklist.pendingTotal)
          : error
            ? '—'
            : null
      }
      caption={
        checklist
          ? snapshot && snapshot.recurring.length === 0
            ? 'nenhuma conta'
            : checklist.pending.length === 0
              ? `${plural(checklist.done.length, 'conta lançada', 'contas lançadas')} ✓`
              : late > 0
                ? `${plural(late, 'conta vencida', 'contas vencidas')}`
                : `${checklist.pending.length === 1 ? 'falta' : 'faltam'} ${plural(checklist.pending.length, 'conta', 'contas')}`
          : error
            ? 'não foi possível carregar'
            : 'carregando…'
      }
    />
  );
}

/**
 * Cartão: the bill of the current competence, when it is due, and how much of the months ahead
 * is already committed to instalments.
 */
export function CardHomeCard() {
  const { snapshot, error } = useWallet();
  const month = currentMonthKey();
  const bills = snapshot ? snapshot.bills.filter((bill) => bill.month === month) : [];
  const total = bills.reduce((sum, bill) => sum + bill.total, 0);
  const open = snapshot ? openBills(snapshot.bills) : [];
  const late = open.filter((bill) => bill.daysUntilDue !== null && bill.daysUntilDue < 0).length;
  const next = open.find((bill) => bill.dueDate !== null);
  const ahead = snapshot ? Math.abs(snapshot.cash.report.installmentDebt) : 0;

  if (error && !snapshot) {
    return (
      <HomeCard module="card" href="/cartao">
        <CardNote tone="danger">{error}</CardNote>
      </HomeCard>
    );
  }

  return (
    <HomeCard module="card" href="/cartao">
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label={`Fatura de ${formatMonthShort(month)}`}
          value={snapshot ? formatBRL(total) : null}
          tone={late > 0 ? 'danger' : undefined}
        />
        <Stat
          label={late > 0 ? 'Atrasadas' : next ? 'Próximo vencimento' : 'Faturas em aberto'}
          value={
            snapshot
              ? late > 0
                ? plural(late, 'fatura', 'faturas')
                : next
                  ? formatDayMonth(next.dueDate as string)
                  : open.length > 0
                    ? formatBRL(open.reduce((sum, bill) => sum + bill.total, 0))
                    : 'tudo pago'
              : null
          }
          tone={late > 0 ? 'danger' : undefined}
        />
      </div>
      {snapshot && (
        <CardNote>
          {ahead > 0
            ? `${formatBRL(ahead)} já comprometidos nos próximos meses`
            : 'Nenhuma parcela comprometida nos próximos meses'}
        </CardNote>
      )}
    </HomeCard>
  );
}

/**
 * Reserva: total reserve, debts and the gap, with how much of the target reserve is covered, and
 * what the quotas of the "Investida" tab are worth, when there are any.
 */
export function CashHomeCard() {
  const { snapshot, error } = useWallet();

  if (error && !snapshot) {
    return (
      <HomeCard module="cash" href="/carteira/caixa">
        <CardNote tone="danger">{error}</CardNote>
      </HomeCard>
    );
  }

  const report = snapshot?.cash.report;
  const invested = snapshot?.investments;
  const available = report ? report.totalReserve + report.totalDebt : 0;
  const covered =
    report && report.expectedReserve > 0
      ? Math.min(Math.max(available / report.expectedReserve, 0), 1)
      : null;

  return (
    <HomeCard module="cash" href="/carteira/caixa">
      <div>
        <p className="text-muted text-xs font-medium">Reserva total</p>
        {report ? (
          <p className="text-foreground text-2xl font-bold tracking-tight tabular-nums">
            {formatBRL(report.totalReserve)}
          </p>
        ) : (
          <Skeleton className="mt-1 h-7 w-32" />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Dívidas"
          value={report ? formatBRL(report.totalDebt) : null}
          tone={report && report.totalDebt < 0 ? 'danger' : undefined}
        />
        <Stat
          label={report && report.gap >= 0 ? 'Reserva completa ✓' : 'Falta para a reserva'}
          value={report ? formatBRL(Math.abs(report.gap)) : null}
          tone={report ? (report.gap >= 0 ? 'success' : 'danger') : undefined}
        />
      </div>
      {report && covered !== null && (
        <div className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-label="Meta da reserva coberta"
            aria-valuenow={Math.round(covered * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="bg-border h-2 w-full overflow-hidden rounded-full"
          >
            <div
              className={`h-full rounded-full ${covered >= 1 ? 'bg-success-fill' : 'bg-primary'}`}
              style={{ width: `${covered * 100}%` }}
            />
          </div>
          <p className="text-muted text-xs">
            {Math.round(covered * 100)}% da meta da reserva de {formatBRL(report.expectedReserve)}, já
            descontadas as dívidas
          </p>
        </div>
      )}
      {invested && invested.totalQuotas > 0 && invested.price !== null && (
        <CardNote>
          {formatBRL(invested.totalValue)} investidos em {invested.ticker}
        </CardNote>
      )}
    </HomeCard>
  );
}
