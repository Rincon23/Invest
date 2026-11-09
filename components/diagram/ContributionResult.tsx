'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Minus, Plus, RotateCcw } from 'lucide-react';
import { amountToInputValue, currentMonthKey, formatBRL, parseAmountInput, todayISO } from '@/lib/budget';
import {
  assetType,
  buildPlan,
  sharesAfter,
  stepQuantity,
  suggestQuantities,
  type AssetType,
  type BlockReason,
  type DiagramOverview,
  type OrphanReason,
  type Plan,
  type PlanInput,
  type PlanLine,
} from '@/lib/diagram';
import { diagramRepository } from '@/lib/storage';
import { AmountInput } from '@/components/ui/AmountInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useToast } from '@/components/ui/Toast';
import { Donut } from './Donut';
import { formatQuantity, pct, quotasLabel } from './format';

const BLOCK_TEXT: Record<BlockReason, string> = {
  stopped: 'Não compro mais',
  noScore: 'Sem nota: responda as perguntas dele',
  lowScore: 'Nota 0 ou menor',
  noPrice: 'Sem cotação',
  typeOff: 'O tipo está com meta 0%',
  typeRedistributed: 'O tipo não recebe neste aporte',
  atTarget: 'Já está na meta',
  waiting: 'Fica para o próximo aporte: outros estão mais longe da meta',
};

const ORPHAN_TEXT: Record<OrphanReason, string> = {
  empty: 'não tem nenhum ativo cadastrado',
  stopped: 'todos os ativos estão com "Não compro mais"',
  noScore: 'nenhum ativo tem nota ainda',
  lowScore: 'nenhum ativo tem nota acima de 0',
  noPrice: 'nenhum ativo tem cotação agora',
  mixed: 'nenhum ativo pode receber (sem nota ou cotação)',
};

/** Why the leftover is there, in a sentence. */
function leftoverText(plan: Plan): string {
  const left = formatBRL(plan.leftover);
  const reason = plan.leftoverReason;
  switch (reason.kind) {
    case 'none':
      return 'Todo o valor tem destino.';
    case 'quotaTooExpensive':
      return `${left} não compram uma cota de ${reason.label} (${formatBRL(reason.price)}): fica para o próximo.`;
    case 'allAtTarget':
      return `Todos chegaram na meta: ${left} ficam para o próximo aporte.`;
    case 'noReceivers':
      return `Nenhum ativo pode receber agora: ${left} sem destino.`;
    case 'unspent':
      return `${left} sem destino. Use o + num ativo ou Refazer sugestão.`;
  }
}

/** What a line buys, in words ("3 cotas × R$ 51,77"); nothing for a total in R$. */
function lineQuantity(line: PlanLine): string | null {
  if (line.unit === 'money') return null;
  return `${quotasLabel(line.quantity, line.type)} × ${formatBRL(line.price ?? 0)}`;
}

/**
 * The result of an aporte: a donut with where the money goes (or the portfolio after it), then
 * only what is bought — quotas and R$ with − / + and "Aportar" — the leftover in one line, and
 * "Aportar tudo". Why the other assets got nothing is in the report folded below.
 */
export function ContributionResult({
  basis,
  launchAvailable,
  onChanged,
}: {
  basis: { input: PlanInput; overview: DiagramOverview };
  /** Lançamentos is on: "Lançar em Investimentos" can be offered. */
  launchAvailable: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const suggested = useMemo(() => suggestQuantities(basis.input), [basis.input]);
  const [quantities, setQuantities] = useState<Record<string, number>>(suggested);
  const [done, setDone] = useState<string[]>([]);
  const [view, setView] = useState<'aporte' | 'depois'>('aporte');
  const [contributing, setContributing] = useState<PlanLine | 'all' | null>(null);

  const plan = useMemo(() => buildPlan(basis.input, quantities), [basis.input, quantities]);
  const pending = plan.lines.filter((line) => !done.includes(line.id) && !line.blocked && line.quantity > 0);
  const after = sharesAfter(plan);

  function adjust(line: PlanLine, direction: 1 | -1) {
    setQuantities((current) => ({ ...current, [line.id]: stepQuantity(line, direction, plan.leftover) }));
  }

  // The lines the suggestion bought (or the person added to) are the purchases on top, even at 0
  // after a "−"; everything else — and why — is in the report below.
  const buying = plan.lines.filter(
    (line) =>
      line.blocked !== 'stopped' &&
      ((suggested[line.id] ?? 0) > 0 || line.quantity > 0 || done.includes(line.id)),
  );
  const buyingTypes = plan.types.filter((type) => buying.some((line) => line.type === type.type));

  return (
    <div className="flex flex-col gap-3">
      <section className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-foreground font-semibold">Resultado</h2>
          <div role="tablist" className="bg-background flex gap-1 rounded-lg p-1 text-xs">
            {(
              [
                ['aporte', 'Aporte'],
                ['depois', 'Carteira depois'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`rounded-md px-2 py-1.5 font-semibold ${view === key ? 'bg-card text-foreground shadow-sm' : 'text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {view === 'aporte' ? (
            <Donut
              label="Distribuição do aporte por tipo"
              slices={plan.types.map((type) => ({
                key: type.type,
                value: type.amount,
                color: assetType(type.type).color,
              }))}
              size={112}
            >
              <span className="text-muted text-[10px]">Aporte</span>
              <span className="text-foreground text-xs font-semibold tabular-nums">
                {formatBRL(plan.spent)}
              </span>
            </Donut>
          ) : (
            <Donut
              label="Carteira depois do aporte, por tipo"
              slices={after.map((item) => ({
                key: item.type,
                value: item.share,
                color: assetType(item.type).color,
              }))}
              size={112}
            >
              <span className="text-muted text-[10px]">Depois</span>
              <span className="text-foreground text-xs font-semibold tabular-nums">
                {formatBRL(plan.invested + plan.spent)}
              </span>
            </Donut>
          )}
          <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
            {plan.types
              .filter((type) => (view === 'aporte' ? type.amount > 0 : true))
              .map((type) => {
                const share = after.find((item) => item.type === type.type)?.share ?? 0;
                return (
                  <li key={type.type} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: assetType(type.type).color }}
                    />
                    <span className="text-foreground min-w-0 flex-1 truncate">
                      {assetType(type.type).shortLabel}
                    </span>
                    <span className="text-foreground tabular-nums">
                      {view === 'aporte'
                        ? formatBRL(type.amount)
                        : `${pct(share)} · meta ${pct(type.target)}`}
                    </span>
                  </li>
                );
              })}
            {view === 'aporte' && plan.spent === 0 && <li className="text-muted">Nada comprado.</li>}
          </ul>
        </div>
      </section>

      {buying.length > 0 && (
        <section className="border-border bg-card divide-border mx-4 flex flex-col divide-y rounded-2xl border shadow-sm">
          {buyingTypes.map((type) => (
            <div key={type.type} className="flex flex-col">
              <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: assetType(type.type).color }}
                />
                <h3 className="text-muted min-w-0 flex-1 truncate text-xs font-semibold uppercase">
                  {assetType(type.type).label}
                </h3>
                <span className="text-muted text-xs tabular-nums">{formatBRL(type.amount)}</span>
              </div>
              <ul className="flex flex-col">
                {buying
                  .filter((line) => line.type === type.type)
                  .map((line) => (
                    <li key={line.id} className="flex items-center gap-2 px-4 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-semibold">{line.label}</p>
                        <p className="text-muted truncate text-xs">
                          {lineQuantity(line) ? `${lineQuantity(line)} = ` : ''}
                          {formatBRL(line.amount)}
                        </p>
                      </div>
                      {done.includes(line.id) ? (
                        <span className="text-success flex items-center gap-1 text-xs font-semibold">
                          <Check aria-hidden className="h-4 w-4" /> Aportado
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => adjust(line, -1)}
                            disabled={line.quantity <= 0}
                            aria-label={`Menos ${line.label}`}
                            className="border-border text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border disabled:opacity-30"
                          >
                            <Minus aria-hidden className="h-4 w-4" />
                          </button>
                          {line.unit !== 'money' && (
                            <span className="text-foreground min-w-[2.5rem] text-center text-sm font-semibold tabular-nums">
                              {formatQuantity(line.quantity, line.type)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => adjust(line, 1)}
                            disabled={stepQuantity(line, 1, plan.leftover) === line.quantity}
                            aria-label={`Mais ${line.label}`}
                            className="border-border text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border disabled:opacity-30"
                          >
                            <Plus aria-hidden className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setContributing(line)}
                            disabled={line.quantity <= 0}
                            className="bg-primary/10 text-primary min-h-[36px] shrink-0 rounded-lg px-3 text-sm font-semibold disabled:opacity-40"
                          >
                            Aportar
                          </button>
                        </>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <p
        className={`mx-4 rounded-xl px-4 py-2.5 text-sm ${
          plan.leftover >= 0.01 ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success'
        }`}
        aria-live="polite"
      >
        <strong>Sobra: {formatBRL(Math.max(0, plan.leftover))}.</strong> {leftoverText(plan)}
      </p>

      <div className="flex gap-3 px-4">
        <button
          type="button"
          onClick={() => setQuantities(suggested)}
          className="border-border text-foreground flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium"
        >
          <RotateCcw aria-hidden className="h-4 w-4" />
          Refazer sugestão
        </button>
        <button
          type="button"
          onClick={() => setContributing('all')}
          disabled={pending.length === 0}
          className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
        >
          Aportar tudo
        </button>
      </div>

      <Report plan={plan} after={after} buying={buying} onAdd={(line) => adjust(line, 1)} />

      {contributing && (
        <ContributeSheet
          lines={contributing === 'all' ? pending : [contributing]}
          single={contributing !== 'all'}
          launchAvailable={launchAvailable}
          onClose={() => setContributing(null)}
          onDone={async (confirmedLines) => {
            setQuantities((current) => ({
              ...current,
              ...Object.fromEntries(confirmedLines.map((line) => [line.id, line.quantity])),
            }));
            setDone((current) => [...current, ...confirmedLines.map((line) => line.id)]);
            setContributing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * "Relatório do aporte", folded at the bottom: for every type, how it goes (% today → after →
 * target) and where each asset stands — what it gets, or why it got nothing. The types that could
 * not receive and the "Não compro mais" ones are here too, so the result above shows only what
 * is bought.
 */
function Report({
  plan,
  after,
  buying,
  onAdd,
}: {
  plan: Plan;
  after: { type: AssetType; share: number }[];
  buying: PlanLine[];
  onAdd: (line: PlanLine) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mx-4 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-muted flex min-h-[40px] items-center gap-1.5 self-start text-sm font-semibold"
      >
        <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        Relatório do aporte
      </button>
      {open && (
        <div className="border-border bg-card divide-border flex flex-col divide-y rounded-2xl border text-xs shadow-sm">
          {plan.types.map((type) => {
            const lines = plan.lines.filter((line) => line.type === type.type);
            const before = plan.invested > 0 ? type.value / plan.invested : 0;
            const share = after.find((item) => item.type === type.type)?.share ?? 0;
            return (
              <div key={type.type} className="flex flex-col gap-1.5 px-4 py-3">
                <p className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ background: assetType(type.type).color }}
                  />
                  <span className="text-foreground flex-1 font-semibold">{assetType(type.type).label}</span>
                  <span className="text-muted tabular-nums">
                    {pct(before)} → {pct(share)} · meta {pct(type.effectiveTarget)}
                  </span>
                </p>
                {type.orphan && (
                  <p className="text-muted">
                    Não recebe: {ORPHAN_TEXT[type.orphan]}. A meta dele ({pct(type.target)}) foi dividida
                    entre os outros tipos.
                  </p>
                )}
                {!type.orphan && Math.abs(type.effectiveTarget - type.target) > 0.0001 && (
                  <p className="text-muted">
                    Sua meta é {pct(type.target)}; recebeu a parte de um tipo que não recebe.
                  </p>
                )}
                <ul className="flex flex-col gap-0.5">
                  {lines.map((line) => {
                    const bought = buying.includes(line) && line.amount > 0;
                    const canAdd =
                      !buying.includes(line) &&
                      (line.blocked === 'waiting' || line.blocked === 'atTarget') &&
                      stepQuantity(line, 1, plan.leftover) !== line.quantity;
                    return (
                      <li key={line.id} className="flex min-h-[28px] items-center gap-2">
                        <span className="text-foreground w-24 shrink-0 truncate font-medium">
                          {line.label}
                        </span>
                        <span className={`min-w-0 flex-1 truncate ${bought ? 'text-success' : 'text-muted'}`}>
                          {bought
                            ? `${lineQuantity(line) ?? 'em reais'} = ${formatBRL(line.amount)}`
                            : line.blocked
                              ? BLOCK_TEXT[line.blocked]
                              : 'Nada neste aporte'}
                          {line.blocked === 'stopped' && plan.invested > 0
                            ? ` · hoje ${pct(line.value / plan.invested)}`
                            : ''}
                        </span>
                        {canAdd && (
                          <button
                            type="button"
                            onClick={() => onAdd(line)}
                            aria-label={`Pôr ${line.label} neste aporte`}
                            className="border-border text-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border"
                          >
                            <Plus aria-hidden className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {lines.length === 0 && <li className="text-muted">Nenhum ativo.</li>}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * "Aportar" (one line, its quantity still editable) or "Aportar tudo": adds the quotas (or the
 * R$, for fixed income) to the portfolio, moves their dates and keeps the aporte in the history.
 */
function ContributeSheet({
  lines,
  single,
  launchAvailable,
  onClose,
  onDone,
}: {
  lines: PlanLine[];
  single: boolean;
  launchAvailable: boolean;
  onClose: () => void;
  onDone: (lines: PlanLine[]) => Promise<void>;
}) {
  const { showToast } = useToast();
  const first = lines[0];
  const [quantity, setQuantity] = useState(
    first.unit === 'money' ? amountToInputValue(first.quantity) : String(first.quantity).replace('.', ','),
  );
  const [launch, setLaunch] = useState(false);
  const [saving, setSaving] = useState(false);

  const edited: PlanLine[] = single
    ? [
        {
          ...first,
          quantity: Math.max(0, parseAmountInput(quantity)),
          amount:
            first.unit === 'money'
              ? Math.max(0, parseAmountInput(quantity))
              : Math.max(0, parseAmountInput(quantity)) * (first.price ?? 0),
        },
      ]
    : lines;
  const total = edited.reduce((sum, line) => sum + line.amount, 0);
  const valid = edited.every((line) => line.quantity > 0);

  return (
    <BottomSheet
      open
      title={single ? `Aportar em ${first.label}` : 'Aportar tudo'}
      onClose={onClose}
      confirmDiscard={false}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid) return;
          setSaving(true);
          try {
            await diagramRepository.contribute({
              date: todayISO(),
              month: currentMonthKey(),
              items: edited.map((line) => ({
                ...(line.unit === 'money' ? {} : { assetId: line.id }),
                type: line.type,
                quantity: line.quantity,
              })),
              launchExpense: launch,
            });
            showToast(
              single
                ? `Aporte registrado: ${edited[0].unit === 'money' ? formatBRL(edited[0].amount) : quotasLabel(edited[0].quantity, edited[0].type)} somado à carteira.`
                : `Aporte de ${formatBRL(total)} registrado na carteira.`,
            );
            await onDone(edited);
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Não foi possível registrar o aporte.', 'error');
          } finally {
            setSaving(false);
          }
        }}
      >
        {single ? (
          first.unit === 'money' ? (
            <AmountInput value={quantity} onChange={setQuantity} autoFocus label="Valor do aporte" />
          ) : (
            <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
              Quantas cotas você comprou
              <input
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                autoFocus
                className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
              />
              <span className="text-muted text-xs font-normal">
                A {formatBRL(first.price ?? 0)} cada: {formatBRL(edited[0].amount)}.
              </span>
            </label>
          )
        ) : (
          <ul className="border-border divide-border flex flex-col divide-y rounded-xl border">
            {edited.map((line) => (
              <li key={line.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                  {line.unit === 'money' ? `${line.label} (${assetType(line.type).shortLabel})` : line.label}
                </span>
                <span className="text-muted text-xs">
                  {line.unit === 'money' ? '' : quotasLabel(line.quantity, line.type)}
                </span>
                <span className="text-foreground font-semibold tabular-nums">{formatBRL(line.amount)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted text-sm">
          As cotas são somadas à sua carteira com a data de hoje, e o aporte fica no histórico.
          {!single && ` Total: ${formatBRL(total)}.`}
        </p>

        {launchAvailable && (
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={launch}
              onChange={(event) => setLaunch(event.target.checked)}
              className="accent-primary mt-0.5 h-5 w-5 shrink-0"
            />
            <span className="flex flex-col">
              <span className="text-foreground text-sm font-medium">Lançar em Investimentos</span>
              <span className="text-muted text-xs">
                Lança {formatBRL(total)} em Investimentos, com a data de hoje.
              </span>
            </span>
          </label>
        )}

        <button
          type="submit"
          disabled={saving || !valid}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Registrando…' : single ? 'Aportar' : `Aportar ${formatBRL(total)}`}
        </button>
      </form>
    </BottomSheet>
  );
}
