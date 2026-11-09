'use client';

import { useEffect, useState } from 'react';
import {
  amountToInputValue,
  computeMonthSummary,
  currentMonthKey,
  formatBRL,
  parseAmountInput,
  todayISO,
  type BudgetSettings,
} from '@/lib/budget';
import {
  assetType,
  fixedIncomeAmount,
  isFixedIncomeType,
  planPositions,
  portfolioByType,
  typesWithTarget,
  UNQUOTED_LABEL,
  type DiagramOverview,
  type FixedIncomeType,
  type PlanInput,
} from '@/lib/diagram';
import { isModuleOn } from '@/lib/modules';
import { budgetRepository, diagramRepository } from '@/lib/storage';
import { AmountInput } from '@/components/ui/AmountInput';
import { useToast } from '@/components/ui/Toast';
import { ContributionResult } from './ContributionResult';
import { formatDate } from './format';
import { PortfolioChart } from './PortfolioCard';

type Step = 'input' | 'fixed' | 'result';

/** What the result was calculated from: frozen, so an "Aportar" on one line keeps the others. */
interface Basis {
  input: PlanInput;
  overview: DiagramOverview;
  /** Each "Calcular" starts a fresh result (its own quantities and lines marked as done). */
  run: number;
}

/**
 * "Aporte": "Quanto você quer investir?" on top, with what the portfolio is worth today (the
 * screen's question and its action), then the portfolio by type, the fixed-income totals brought
 * up to date (there is no quote for them), and the result.
 */
export function AporteTab({
  overview,
  settings,
  onChanged,
  onOpenTargets,
}: {
  overview: DiagramOverview;
  settings: BudgetSettings;
  onChanged: () => Promise<DiagramOverview | null>;
  onOpenTargets: () => void;
}) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState(
    overview.settings.lastAmount ? amountToInputValue(overview.settings.lastAmount) : '',
  );
  const [step, setStep] = useState<Step>('input');
  const [confirmed, setConfirmed] = useState<FixedIncomeType[]>([]);
  const [basis, setBasis] = useState<Basis | null>(null);
  const [investmentsLeft, setInvestmentsLeft] = useState<number | null>(null);

  const parsed = Math.max(0, parseAmountInput(amount));
  const withTarget = typesWithTarget(overview.settings.targets);
  const fixedTypes = withTarget.filter((type): type is FixedIncomeType => isFixedIncomeType(type));
  const budgetOn = isModuleOn(settings, 'budget');
  const portfolioTotal = portfolioByType(overview).total;

  // "Usar o que sobrou em Investimentos": what the category still has this month.
  useEffect(() => {
    if (!budgetOn) return;
    const topic = settings.topics.find((item) => item.preset === 'investimentos' && !item.archived);
    if (!topic) return;
    let cancelled = false;
    void budgetRepository
      .peekMonth(currentMonthKey())
      .then((month) => {
        const result = computeMonthSummary(month, settings.topics).topics.find(
          (item) => item.topicId === topic.id,
        );
        if (!cancelled) setInvestmentsLeft(result ? result.remaining : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [budgetOn, settings.topics]);

  function showResult(source: DiagramOverview) {
    const input: PlanInput = {
      amount: parsed,
      targets: source.settings.targets,
      positions: planPositions(source),
    };
    setBasis((current) => ({ input, overview: source, run: (current?.run ?? 0) + 1 }));
    setStep('result');
  }

  function calculate() {
    if (!(parsed > 0)) return;
    void diagramRepository.saveLastAmount(parsed).catch(() => undefined);
    setConfirmed([]);
    if (fixedTypes.length > 0) setStep('fixed');
    else showResult(overview);
  }

  async function confirmFixed(type: FixedIncomeType, value: number) {
    try {
      await diagramRepository.setFixedIncome(type, value, todayISO());
      const next = [...confirmed.filter((item) => item !== type), type];
      setConfirmed(next);
      const fresh = await onChanged();
      if (fresh && fixedTypes.every((item) => next.includes(item))) showResult(fresh);
    } catch {
      showToast('Não foi possível salvar o valor.', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section
        data-tour="diagrama-valor"
        className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm"
      >
        <div>
          <h2 className="text-foreground font-semibold">Quanto você quer investir?</h2>
          {portfolioTotal > 0 && (
            <p className="text-muted text-sm">
              Carteira hoje:{' '}
              <span className="text-foreground font-semibold tabular-nums">{formatBRL(portfolioTotal)}</span>
            </p>
          )}
        </div>
        {withTarget.length === 0 ? (
          <>
            <p className="text-muted text-sm">
              Antes, escolha os tipos da carteira e o peso de cada um.
            </p>
            <button
              type="button"
              onClick={onOpenTargets}
              className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold"
            >
              Escolher tipos e metas
            </button>
          </>
        ) : (
          <>
            <AmountInput
              value={amount}
              onChange={(value) => {
                setAmount(value);
                if (step !== 'input') setStep('input');
              }}
              label="Quanto você quer investir"
            />
            {investmentsLeft !== null && investmentsLeft > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAmount(amountToInputValue(investmentsLeft));
                  setStep('input');
                }}
                className="border-border text-foreground self-start rounded-full border px-3 py-1.5 text-xs font-medium"
              >
                Usar o que sobrou em Investimentos no mês: {formatBRL(investmentsLeft)}
              </button>
            )}
            <button
              type="button"
              onClick={calculate}
              disabled={!(parsed > 0)}
              className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
            >
              {step === 'result' ? 'Calcular de novo' : 'Calcular'}
            </button>
          </>
        )}
      </section>

      <section
        data-tour="diagrama-carteira"
        className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm"
      >
        <h2 className="text-muted text-sm font-semibold">Sua carteira: hoje × meta</h2>
        <PortfolioChart overview={overview} />
      </section>

      {step === 'fixed' && (
        <section className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
          <h2 className="text-foreground font-semibold">Atualize a renda fixa</h2>
          <p className="text-muted text-sm">Tesouro, CDB e LCI: confira o total de hoje.</p>
          {fixedTypes.map((type) => (
            <FixedIncomeCheck
              key={type}
              type={type}
              amount={fixedIncomeAmount(overview, type)}
              updatedOn={overview.fixedIncome.find((item) => item.type === type)?.updatedOn ?? null}
              done={confirmed.includes(type)}
              onConfirm={(value) => confirmFixed(type, value)}
            />
          ))}
        </section>
      )}

      {step === 'result' && basis && (
        <ContributionResult
          key={basis.run}
          basis={basis}
          launchAvailable={isModuleOn(settings, 'expenses')}
          onChanged={onChanged}
        />
      )}

      {overview.contributions.length > 0 && (
        <section className="flex flex-col gap-2 px-4">
          <h2 className="text-muted text-sm font-semibold">Últimos aportes</h2>
          <ul className="border-border bg-card divide-border flex flex-col divide-y rounded-xl border shadow-sm">
            {overview.contributions.slice(0, 5).map((contribution) => (
              <li key={contribution.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-muted w-20 shrink-0 tabular-nums">{formatDate(contribution.date)}</span>
                <span className="text-muted min-w-0 flex-1 truncate text-xs">
                  {contribution.items
                    .map((item) => item.ticker ?? assetType(item.type).shortLabel)
                    .join(', ')}
                </span>
                <span className="text-foreground font-semibold tabular-nums">
                  {formatBRL(contribution.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One fixed-income total: "Continua igual" in one tap, or a new value. */
function FixedIncomeCheck({
  type,
  amount,
  updatedOn,
  done,
  onConfirm,
}: {
  type: FixedIncomeType;
  amount: number;
  updatedOn: string | null;
  done: boolean;
  onConfirm: (value: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(amountToInputValue(amount));
  const [busy, setBusy] = useState(false);

  async function confirm(next: number) {
    setBusy(true);
    try {
      await onConfirm(next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-background flex flex-col gap-2 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: assetType(type).color }}
        />
        <span className="text-foreground min-w-0 flex-1 text-sm font-medium">
          {UNQUOTED_LABEL} · {assetType(type).shortLabel}
        </span>
        {done && <span className="text-success text-xs font-semibold">Conferido ✓</span>}
      </div>
      <p className="text-muted text-xs">
        {updatedOn
          ? `Último valor: ${formatBRL(amount)}, em ${formatDate(updatedOn)}.`
          : 'Ainda não informado.'}
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          <AmountInput
            value={value}
            onChange={setValue}
            autoFocus
            label={`Total de ${assetType(type).label}`}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm(Math.max(0, parseAmountInput(value)))}
            className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      ) : (
        !done && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirm(amount)}
              className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
            >
              {updatedOn ? 'Continua igual' : 'É zero'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
              className="border-border text-foreground min-h-[44px] flex-1 rounded-lg border px-3 text-sm font-medium"
            >
              {updatedOn ? 'Mudou' : 'Informar'}
            </button>
          </div>
        )
      )}
    </div>
  );
}
