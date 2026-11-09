'use client';

import { useEffect, useState } from 'react';
import {
  FIXED_COST_TIP,
  activeTopics as activeTopicsOf,
  amountToInputValue,
  computeAvailable,
  computeProportionalFixed,
  createId,
  currentMonthKey,
  formatBRL,
  formatPct,
  normalizeTopic,
  parseAmountInput,
  sum,
  validateTopicPercentages,
  validatePositiveAmount,
  type BudgetSettings,
  type TopicConfig,
} from '@/lib/budget';
import { budgetRepository } from '@/lib/storage';
import { getUnforeseenEstimate, setUnforeseenEstimate } from '@/lib/storage/preferences';
import { useMissions } from '@/components/missions/MissionsProvider';
import { AmountInput } from '@/components/ui/AmountInput';
import { InfoTip } from '@/components/ui/InfoTip';
import { PercentInput } from '@/components/ui/PercentInput';
import { OnboardingScreen } from './OnboardingScreen';

const TOTAL_STEPS = 3;

interface OnboardingWizardProps {
  settings: BudgetSettings;
  saveSettings: (settings: BudgetSettings) => Promise<void>;
  onSkip: () => void;
  /** Fires once the user confirms the last step and every write has succeeded. */
  onComplete: () => void;
}

/**
 * The three questions that set up the categories (right after a new account picks how to use the
 * app, on the first visit to Categorias and from "Me ajude com as %"): the income; the fixed and
 * unforeseen costs, on one screen; and the percentages, each category with what it is for and a
 * live preview of what it gets. The four categories are always the same (see CategoriesSettings):
 * only their % change here.
 */
export function OnboardingWizard({ settings, saveSettings, onSkip, onComplete }: OnboardingWizardProps) {
  const { visit } = useMissions();
  const [step, setStep] = useState(1);
  const [income, setIncome] = useState('');
  const [registerIncome, setRegisterIncome] = useState(true);
  const [fixedCosts, setFixedCosts] = useState('');
  const [unforeseen, setUnforeseen] = useState(() => {
    const stored = getUnforeseenEstimate();
    return stored ? amountToInputValue(stored) : '';
  });
  const [topics, setTopics] = useState<TopicConfig[]>(() => settings.topics.map(normalizeTopic));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Best-effort prefill from the current month, so reopening via "Me ajude com as %"
  // isn't a blank slate. Doesn't block the UI — it's fine if step 1 renders first.
  useEffect(() => {
    let active = true;
    void budgetRepository.peekMonth(currentMonthKey()).then((data) => {
      if (!active) return;
      const incomeTotal = sum(data.incomes.map((i) => i.amount));
      if (incomeTotal > 0) {
        setIncome(amountToInputValue(incomeTotal));
        setRegisterIncome(false);
      }
      const fixedTotal = sum(
        data.expenses.filter((e) => e.categoryKind === 'fixedCost').map((e) => e.amount),
      );
      if (fixedTotal > 0) setFixedCosts(amountToInputValue(fixedTotal));
    });
    return () => {
      active = false;
    };
  }, []);

  const activeTopics = activeTopicsOf(topics);
  const validation = validateTopicPercentages(topics);

  function updateTopic(id: string, targetPct: number) {
    setTopics((prev) => prev.map((t) => (t.id === id ? { ...t, targetPct } : t)));
  }

  function goNext() {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handleFinish() {
    setSaving(true);
    setError(null);
    try {
      await saveSettings({
        ...settings,
        topics,
      });

      const month = currentMonthKey();
      const parsedIncome = parseAmountInput(income);
      if (registerIncome && parsedIncome > 0) {
        await budgetRepository.saveIncome(month, {
          id: createId(),
          source: 'Renda mensal',
          amount: parsedIncome,
          date: `${month}-01`,
        });
      }

      const parsedUnforeseen = parseAmountInput(unforeseen);
      if (parsedUnforeseen > 0) setUnforeseenEstimate(parsedUnforeseen);

      // Finishing is the mission, even keeping the % as they were; skipping is not.
      visit('setup-categories');
      onComplete();
    } catch {
      setError('Não foi possível salvar. Tente novamente.');
      setSaving(false);
    }
  }

  if (step === 1) {
    return (
      <OnboardingScreen
        step={step}
        totalSteps={TOTAL_STEPS}
        onSkip={onSkip}
        footer={
          <PrimaryButton onClick={goNext} disabled={!validatePositiveAmount(parseAmountInput(income))}>
            Continuar
          </PrimaryButton>
        }
      >
        <StepHeading title="Quanto você ganha por mês?" subtitle="Se a renda varia, use uma média." />
        <AmountInput value={income} onChange={setIncome} autoFocus label="Renda por mês" />
        <label className="text-foreground mt-4 flex min-h-[44px] items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={registerIncome}
            onChange={(e) => setRegisterIncome(e.target.checked)}
            className="border-border h-5 w-5 rounded"
          />
          Registrar como minha renda deste mês
        </label>
      </OnboardingScreen>
    );
  }

  if (step === 2) {
    return (
      <OnboardingScreen
        step={step}
        totalSteps={TOTAL_STEPS}
        onSkip={onSkip}
        footer={
          <>
            <BackButton onClick={goBack} />
            <PrimaryButton onClick={goNext}>Continuar</PrimaryButton>
          </>
        }
      >
        <StepHeading title="Custos fixos e imprevistos" subtitle="Só para a prévia: nada é lançado agora." />
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <InfoTip
              info={FIXED_COST_TIP}
              label="Quando um gasto é custo fixo?"
              hint="Aluguel, contas, assinaturas, plano de saúde."
            >
              <span className="text-foreground font-semibold">Custos fixos por mês</span>
            </InfoTip>
            <AmountInput value={fixedCosts} onChange={setFixedCosts} autoFocus label="Custos fixos por mês" />
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-foreground font-semibold">Imprevistos por mês</p>
              <p className="text-muted text-sm">Uma média: consulta, conserto, óculos.</p>
            </div>
            <AmountInput value={unforeseen} onChange={setUnforeseen} label="Imprevistos por mês" />
          </div>
        </div>
      </OnboardingScreen>
    );
  }

  const incomeTotal = parseAmountInput(income);
  const fixedTotal = parseAmountInput(fixedCosts);
  const unforeseenTotal = parseAmountInput(unforeseen);
  const preview = activeTopics.map((topic) => {
    const proportionalFixed = computeProportionalFixed(fixedTotal, unforeseenTotal, topic.targetPct);
    const available = computeAvailable(incomeTotal, topic.targetPct, proportionalFixed, 0);
    return { ...topic, available };
  });
  const forTopics = incomeTotal - fixedTotal - unforeseenTotal;

  return (
    <OnboardingScreen
      step={step}
      totalSteps={TOTAL_STEPS}
      onSkip={onSkip}
      footer={
        <>
          <BackButton onClick={goBack} disabled={saving} />
          <PrimaryButton onClick={handleFinish} disabled={saving || !validation.valid}>
            {saving ? 'Salvando…' : 'Concluir configuração'}
          </PrimaryButton>
        </>
      }
    >
      <StepHeading
        title="Quanto vai para cada categoria?"
        subtitle="Custos fixos e imprevistos já saem de cada uma."
      />
      <div className="border-border bg-card mb-4 flex flex-col gap-1 rounded-xl border p-4 text-sm">
        <Row label="Renda" value={formatBRL(incomeTotal)} />
        <Row label="Custos fixos e imprevistos" value={`− ${formatBRL(fixedTotal + unforeseenTotal)}`} />
        <div className="border-border mt-1 flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-foreground font-semibold">Para as categorias</span>
          <span className={`font-semibold tabular-nums ${forTopics < 0 ? 'text-danger' : 'text-foreground'}`}>
            {formatBRL(forTopics)}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {preview.map((topic) => (
          <div key={topic.id} className="border-border flex gap-3 rounded-lg border p-3 text-sm">
            <span
              aria-hidden
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: topic.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate font-semibold">{topic.name}</p>
              {topic.description && <p className="text-muted mt-0.5 text-xs">{topic.description}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <div className="flex items-center gap-1">
                <PercentInput
                  value={topic.targetPct}
                  onChange={(pct) => updateTopic(topic.id, pct)}
                  ariaLabel={`Percentual de ${topic.name}`}
                />
                <span className="text-muted">%</span>
              </div>
              <span className="text-foreground font-semibold tabular-nums">{formatBRL(topic.available)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className={`mt-3 text-sm font-medium ${validation.valid ? 'text-success' : 'text-danger'}`}>
        {validation.valid
          ? 'Somam 100% ✓'
          : validation.diffPct > 0
            ? `Faltam ${formatPct(validation.diffPct)} para 100%.`
            : `Passou ${formatPct(-validation.diffPct)} de 100%.`}
      </p>
      {error && <p className="bg-danger-bg text-danger mt-4 rounded-lg px-3 py-2 text-sm">{error}</p>}
    </OnboardingScreen>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-foreground text-xl font-bold">{title}</h1>
      <p className="text-muted mt-1.5 text-sm">{subtitle}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="border-border text-foreground min-h-[44px] shrink-0 rounded-lg border px-4 py-2 font-medium disabled:opacity-50"
    >
      Voltar
    </button>
  );
}
