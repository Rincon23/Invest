import { formatBRL, type MonthSummary } from '@/lib/budget';

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted truncate text-[11px]">{label}</p>
      <p className="text-foreground truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * The top of Categorias: the month's income and everything spent. No "Ainda posso gastar" or
 * "Para as categorias" summed over all of them — a single total read as if the whole of it could
 * go to anything (the owner asked it out); what is left lives in each category's card.
 */
export function SummaryHeader({ summary }: { summary: MonthSummary }) {
  return (
    <div className="border-border bg-card grid grid-cols-2 gap-2 rounded-2xl border p-4 shadow-sm">
      <SmallStat label="Renda" value={formatBRL(summary.incomeTotal)} />
      <SmallStat label="Total gasto" value={formatBRL(summary.expenseTotal)} />
    </div>
  );
}
