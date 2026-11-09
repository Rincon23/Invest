'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  RESERVE_CONTRIBUTION_NOTE,
  RESERVE_PLAN_EXPLANATION,
  amountToInputValue,
  currentMonthKey,
  formatBRL,
  formatMonthLabel,
  formatMonthShort,
  openBills,
  parseAmountInput,
  reservePlanProblem,
  resolveSpecialCategoryLabels,
  todayISO,
  type CashSettings,
  type ReservePlan,
  type ReservePlanSummary,
} from '@/lib/budget';
import { reserveStatusLine, type BankReserve, type ReserveSource } from '@/lib/banks';
import { isModuleOn, mayUseModule } from '@/lib/modules';
import { banksRepository, walletRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { AmountInput } from '@/components/ui/AmountInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { CategoryPicker, type CategoryValue } from '@/components/ui/CategoryPicker';
import { InfoTip } from '@/components/ui/InfoTip';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useToast } from '@/components/ui/Toast';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton, ModuleSettingsButton } from '@/components/modules/ModuleHelpButton';
import { ModuleSettingsSheet } from '@/components/modules/ModuleSettingsSheet';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useModuleIntro } from '@/components/modules/useModuleIntro';
import { InvestedReserve, TickerSection } from '@/components/wallet/InvestedReserve';
import { useWallet } from '@/components/wallet/WalletProvider';

/** The two halves of the Reserva: the emergency reserve and the reserve in quotas. */
export type ReserveTab = 'emergencia' | 'investida';

const TABS: { key: ReserveTab; label: string }[] = [
  { key: 'emergencia', label: 'Emergência' },
  { key: 'investida', label: 'Investida' },
];

export function CaixaScreen({ initialTab }: { initialTab?: ReserveTab }) {
  return (
    <ModuleGate module="cash">
      <Caixa initialTab={initialTab} />
    </ModuleGate>
  );
}

/**
 * The number the screen is for: what the reserve has, debts already taken out, against its target,
 * with a bar and what is still missing (or "Reserva completa ✓").
 */
function ReserveHero({ available, target, gap }: { available: number; target: number; gap: number }) {
  // Without a target yet, the bar only fills when there is something and nothing is missing.
  const covered =
    target > 0 ? Math.min(Math.max(available / target, 0), 1) : gap >= 0 && available > 0 ? 1 : 0;
  return (
    <div data-tour="caixa-gap" className="flex flex-col gap-2">
      <p className="text-muted text-sm">Sua reserva, já sem as dívidas</p>
      <p className="text-foreground text-2xl font-bold tabular-nums">
        {formatBRL(available)}{' '}
        {target > 0 && <span className="text-muted text-base font-medium">de {formatBRL(target)}</span>}
      </p>
      <div className="bg-border h-2.5 overflow-hidden rounded-full" aria-hidden>
        <div
          className={`h-full rounded-full ${covered >= 1 ? 'bg-success-fill' : 'bg-primary'}`}
          style={{ width: `${covered * 100}%` }}
        />
      </div>
      <p className={`text-sm font-semibold ${gap >= 0 ? 'text-success' : 'text-danger'}`}>
        {gap >= 0 ? 'Reserva completa ✓' : `Faltam ${formatBRL(-gap)}`}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
  tone?: 'danger' | 'success';
}) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-muted min-w-0">
        {label}
        {hint && <span className="text-muted block text-xs">{hint}</span>}
      </span>
      <span
        className={`shrink-0 ${strong ? 'text-base font-semibold' : 'font-medium'} ${
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-foreground'
        }`}
      >
        {formatBRL(value)}
      </span>
    </div>
  );
}

/**
 * The Reserva, one module for what used to be two ("Reserva de emergência" and "Reserva
 * investida"): the emergency reserve against its target, and the quotas it keeps invested.
 */
function Caixa({ initialTab }: { initialTab?: ReserveTab }) {
  const backHref = useHomeHref();
  const { snapshot, loading, error } = useWallet();
  const { settings } = useSettings();
  const [tab, setTab] = useState<ReserveTab>(initialTab ?? 'emergencia');
  const [configuring, setConfiguring] = useState(false);
  /** Reserve in the account, invested, debts and the target: behind "Ver detalhes". */
  const [details, setDetails] = useState(false);
  /** O formulário do plano, criando ou ajustando. */
  const [planning, setPlanning] = useState(false);
  /** O lançamento de uma parcela do plano. */
  const [contributing, setContributing] = useState(false);
  useModuleIntro('cash', { ready: !!snapshot });
  // Open Finance: "Reserva em conta" can come from the accounts the person marked.
  const { user } = useAuth();
  const banksOn = isModuleOn(settings, 'banks') && mayUseModule(user, 'banks');
  const [bankReserve, setBankReserve] = useState<BankReserve | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!banksOn) return;
    let active = true;
    banksRepository
      .getReserve()
      .then((reserve) => {
        if (active) setBankReserve(reserve);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // Read again whenever the wallet changed (a save of the settings, say).
  }, [banksOn, snapshot]);
  const reserveLine = banksOn && bankReserve ? reserveStatusLine(bankReserve, now) : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  if ((loading && !snapshot) || !snapshot) {
    return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
  }

  const { report } = snapshot.cash;
  // The debt is every bill still waiting for "Fatura paga" — which can be more than one
  // competence, and includes the "Não informado" one, since no bill leaves on its own.
  const open = isModuleOn(settings, 'card') ? openBills(snapshot.bills) : null;
  const cardDebtHint = open
    ? open.length === 0
      ? 'Todas as faturas pagas'
      : `Faturas em aberto: ${open.map((bill) => `${bill.cardName} (${formatMonthShort(bill.month)})`).join(', ')}`
    : `Fatura de ${formatMonthLabel(report.cardMonth)}`;

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      <PageHeader
        title="Reserva"
        backHref={backHref}
        action={
          <>
            <ModuleHelpButton module="cash" />
            <ModuleSettingsButton
              module="cash"
              tourAnchor="caixa-config"
              onClick={() => setConfiguring(true)}
            />
          </>
        }
      />

      {error && <p className="bg-danger-bg text-danger mx-4 rounded-lg px-3 py-2 text-sm">{error}</p>}

      <div className="flex gap-2 overflow-x-auto px-4" data-no-swipe-nav>
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            data-tour={`reserva-aba-${item.key}`}
            className={`min-h-[40px] shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium ${
              tab === item.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'investida' && <InvestedReserve />}

      {tab === 'emergencia' && (
        <>
          <section className="border-border bg-card mx-4 flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
            <ReserveHero
              available={report.totalReserve + report.totalDebt}
              target={report.expectedReserve}
              gap={report.gap}
            />
            <button
              type="button"
              onClick={() => setDetails((open) => !open)}
              aria-expanded={details}
              aria-controls="caixa-detalhes"
              data-tour="caixa-detalhes"
              className="text-primary flex min-h-[40px] items-center gap-1 self-start text-sm font-semibold"
            >
              {details ? 'Esconder detalhes' : 'Ver detalhes'}
              <ChevronDown
                aria-hidden
                className={`h-4 w-4 transition-transform ${details ? 'rotate-180' : ''}`}
              />
            </button>
            <div id="caixa-detalhes" hidden={!details} className="flex flex-col gap-3">
              <div data-tour="caixa-reserva" className="flex flex-col gap-3">
                <Row label="Reserva em conta" value={report.reserveAccount} hint={reserveLine?.text} />
                <Row
                  label="Reserva investida"
                  value={report.investedReserve}
                  hint="Só a parte sem categoria da reserva"
                />
                <Row label="Valor total de reserva" value={report.totalReserve} strong />
              </div>

              <hr className="border-border" />

              <div data-tour="caixa-dividas" className="flex flex-col gap-3">
                <Row
                  label="Dívida do cartão"
                  value={report.cardDebt}
                  hint={cardDebtHint}
                  tone={report.cardDebt < 0 ? 'danger' : undefined}
                />
                <Row
                  label="Dívida dos parcelados"
                  value={report.installmentDebt}
                  hint="Parcelas que ainda vão ser cobradas"
                  tone={report.installmentDebt < 0 ? 'danger' : undefined}
                />
                <Row
                  label="Dívida total"
                  value={report.totalDebt}
                  strong
                  tone={report.totalDebt < 0 ? 'danger' : undefined}
                />
              </div>

              <hr className="border-border" />

              <div className="flex flex-col gap-3">
                <Row
                  label="Meta da reserva"
                  value={report.expectedReserve}
                  hint={`${report.multiplier}× o custo mensal de ${formatBRL(report.monthlyCost)}`}
                />
                <Row
                  label={report.gap >= 0 ? 'Reserva completa ✓' : 'Falta para a reserva'}
                  value={report.gap}
                  hint={report.gap >= 0 ? 'Você já tem o que precisa' : 'Quanto falta juntar'}
                  strong
                  tone={report.gap >= 0 ? 'success' : 'danger'}
                />
              </div>
            </div>
          </section>

          <ReservePlanSection
            plan={snapshot.cash.plan}
            gap={report.gap}
            onCreate={() => setPlanning(true)}
            onEdit={() => setPlanning(true)}
            onContribute={() => setContributing(true)}
          />
        </>
      )}

      {configuring && (
        <ModuleSettingsSheet module="cash" onClose={() => setConfiguring(false)}>
          <CashSettingsForm
            settings={snapshot.cash.settings}
            bankReserve={banksOn ? bankReserve : null}
            onBankReserve={setBankReserve}
            now={now}
          />
          <TickerSection ticker={snapshot.investments.ticker} />
        </ModuleSettingsSheet>
      )}

      {planning && (
        <ReservePlanSheet plan={snapshot.cash.plan} gap={report.gap} onClose={() => setPlanning(false)} />
      )}

      {contributing && snapshot.cash.plan && (
        <ReserveContributionSheet plan={snapshot.cash.plan} onClose={() => setContributing(false)} />
      )}
    </div>
  );
}

/**
 * O plano de recompor a reserva. Só aparece com voz de comando quando o gap está negativo — é aí
 * que ele serve para alguma coisa —, mas quem quiser montar a reserva do zero também acha o botão.
 */
function ReservePlanSection({
  plan,
  gap,
  onCreate,
  onEdit,
  onContribute,
}: {
  plan: ReservePlanSummary | null;
  gap: number;
  onCreate: () => void;
  onEdit: () => void;
  onContribute: () => void;
}) {
  if (!plan) {
    return (
      <section className="px-4">
        {gap < 0 ? (
          <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
            <div>
              <p className="text-foreground font-semibold">
                Faltam {formatBRL(Math.abs(gap))} para a sua reserva
              </p>
              <div className="mt-1">
                <InfoTip info={RESERVE_PLAN_EXPLANATION} label="Como funciona o plano?">
                  <span className="text-muted text-sm">
                    Um plano devolve o que falta aos poucos, como imprevisto.
                  </span>
                </InfoTip>
              </div>
            </div>
            <button
              type="button"
              onClick={onCreate}
              className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold"
            >
              Montar um plano
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onCreate}
            className="text-muted hover:text-foreground min-h-[44px] w-full text-sm font-medium underline underline-offset-2"
          >
            Montar um plano para a reserva
          </button>
        )}
      </section>
    );
  }

  const missingThisMonth = Math.max(0, plan.monthly - plan.contributedThisMonth);

  return (
    <section className="border-border bg-card mx-4 flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground font-semibold">Plano da reserva</p>
          {plan.plan.reason && <p className="text-muted truncate text-xs">{plan.plan.reason}</p>}
        </div>
        <button type="button" onClick={onEdit} className="text-primary shrink-0 text-sm font-medium">
          Editar
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted">
            {formatBRL(plan.contributed)} de {formatBRL(plan.plan.targetAmount)}
          </span>
          <span className="text-foreground font-semibold">{Math.round(plan.progress * 100)}%</span>
        </div>
        <ProgressBar usedPct={plan.progress} state={plan.done ? 'ok' : 'warning'} />
      </div>

      {plan.done ? (
        <p className="bg-success-bg text-success rounded-lg px-3 py-2 text-sm font-medium">
          Plano cumprido: a reserva recebeu tudo.
        </p>
      ) : (
        <>
          <p className="text-muted text-sm">
            {formatBRL(plan.monthly)} por mês · faltam {plan.monthsLeft}{' '}
            {plan.monthsLeft === 1 ? 'mês' : 'meses'} ({formatBRL(plan.remaining)})
          </p>
          <button
            type="button"
            onClick={onContribute}
            className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold"
          >
            {plan.contributedThisMonth === 0
              ? 'Lançar a parcela deste mês'
              : missingThisMonth > 0
                ? `Lançar mais (faltam ${formatBRL(missingThisMonth)} neste mês)`
                : 'A parcela deste mês já foi — lançar mais'}
          </button>
        </>
      )}
    </section>
  );
}

/** Quanto recompor e em quantos meses. O resto do plano é calculado a partir do que for lançado. */
function ReservePlanSheet({
  plan,
  gap,
  onClose,
}: {
  plan: ReservePlanSummary | null;
  gap: number;
  onClose: () => void;
}) {
  const { run } = useWallet();
  const { showToast } = useToast();
  const confirm = useConfirm();
  // Sem plano, o buraco da reserva é o palpite óbvio: é exatamente o que falta. Com a reserva já
  // completa não há palpite nenhum, e o campo fica vazio em vez de sugerir zero.
  const [target, setTarget] = useState(() => {
    if (plan) return amountToInputValue(plan.plan.targetAmount);
    return gap < 0 ? amountToInputValue(-gap) : '';
  });
  const [months, setMonths] = useState(String(plan?.plan.months ?? 6));
  const [reason, setReason] = useState(plan?.plan.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsedTarget = parseAmountInput(target);
  const parsedMonths = Number.parseInt(months, 10);
  const draft: ReservePlan = {
    targetAmount: parsedTarget,
    months: parsedMonths,
    startMonth: plan?.plan.startMonth ?? currentMonthKey(),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  };
  const problem = reservePlanProblem(draft);
  const monthly = problem ? 0 : parsedTarget / parsedMonths;

  async function handleDelete() {
    const confirmed = await confirm({
      title: 'Desistir do plano',
      message: 'O plano sai; as parcelas lançadas continuam.',
      confirmLabel: 'Desistir',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await run(() => walletRepository.deleteReservePlan());
      showToast('Plano encerrado.');
      onClose();
    } catch {
      setError('Não foi possível encerrar o plano. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open title={plan ? 'Editar o plano' : 'Montar um plano'} onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (problem) {
            setError(problem);
            return;
          }
          setError(null);
          setSaving(true);
          try {
            await run(() => walletRepository.saveReservePlan(draft));
            showToast(plan ? 'Plano atualizado.' : 'Plano criado.');
            onClose();
          } catch {
            setError('Não foi possível salvar. Tente de novo.');
          } finally {
            setSaving(false);
          }
        }}
      >
        {!plan && <p className="text-muted text-sm">Devolva à reserva, mês a mês, o que um imprevisto tirou.</p>}

        <AmountInput value={target} onChange={setTarget} label="Quanto recompor" autoFocus={!plan} />

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Em quantos meses
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={months}
            onChange={(event) => setMonths(event.target.value)}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-28 rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          O que abriu o buraco (opcional)
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: Cirurgia, conserto do carro..."
            maxLength={200}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>

        {!problem && (
          <p className="bg-background text-foreground rounded-lg px-3 py-2 text-sm">
            {formatBRL(parsedTarget)} em {parsedMonths} {parsedMonths === 1 ? 'mês' : 'meses'} ={' '}
            <strong>{formatBRL(monthly)} por mês</strong>.
          </p>
        )}

        {error && <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          {plan && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={saving}
              className="border-danger text-danger min-h-[44px] rounded-lg border px-4 py-2 font-semibold disabled:opacity-50"
            >
              Desistir
            </button>
          )}
          <button
            type="submit"
            disabled={saving || !!problem}
            className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}

/**
 * Uma parcela do plano: o gasto do mês, que é o que o plano acompanha. Não pergunta onde o
 * dinheiro vai ficar — na conta ou em cotas — porque isso não muda nada aqui e continua sendo a
 * pessoa quem diz, na reserva em conta e nas cotas.
 */
function ReserveContributionSheet({ plan, onClose }: { plan: ReservePlanSummary; onClose: () => void }) {
  const { run, month } = useWallet();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const suggested = Math.max(0, Math.min(plan.monthly - plan.contributedThisMonth, plan.remaining));
  const [amount, setAmount] = useState(amountToInputValue(suggested || plan.remaining));
  const [category, setCategory] = useState<CategoryValue>({ categoryKind: 'unforeseen' });
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const labels = resolveSpecialCategoryLabels(settings?.specialCategories);
  const parsed = parseAmountInput(amount);

  return (
    <BottomSheet open title="Lançar no plano" onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!(parsed > 0)) return;
          setError(null);
          setSaving(true);
          try {
            await run(() =>
              walletRepository.contributeToReserve({
                amount: parsed,
                month,
                date,
                categoryKind: category.categoryKind,
                ...(category.categoryKind === 'topic' && category.topicId
                  ? { topicId: category.topicId }
                  : {}),
              }),
            );
            showToast('Parcela lançada.');
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Não foi possível lançar. Tente novamente.');
          } finally {
            setSaving(false);
          }
        }}
      >
        <AmountInput value={amount} onChange={setAmount} autoFocus />

        <CategoryPicker
          topics={settings?.topics ?? []}
          specialCategories={labels}
          value={category}
          onChange={setCategory}
          showUncounted={false}
          recommended="unforeseen"
        />
        <p className="text-muted -mt-3 text-xs">
          Recompor é imprevisto: fecha um buraco, não rende.
        </p>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Data
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>

        <p className="text-muted text-sm">
          Entra como &ldquo;Recompor a reserva&rdquo; no mês de {formatMonthLabel(month)}. Depois desta
          parcela, faltam {formatBRL(Math.max(0, plan.remaining - parsed))} do plano.{' '}
          {RESERVE_CONTRIBUTION_NOTE}
        </p>

        {error && <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={saving || !(parsed > 0)}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Confirmar'}
        </button>
      </form>
    </BottomSheet>
  );
}

/** A cost line while it is being edited: the amount stays as typed until it is saved. */
interface CostDraft {
  label: string;
  amount: string;
}

/** Reserve in the bank, the "no income" monthly costs and how many months to cover. */
function CashSettingsForm({
  settings,
  bankReserve,
  onBankReserve,
  now,
}: {
  settings: CashSettings;
  /** Null without Open Finance: the reserve is always typed. */
  bankReserve: BankReserve | null;
  onBankReserve: (reserve: BankReserve) => void;
  now: number;
}) {
  const { run } = useWallet();
  const { showToast } = useToast();
  const [reserve, setReserve] = useState(amountToInputValue(settings.reserveAccountAmount));
  const [costs, setCosts] = useState<CostDraft[]>(() =>
    settings.emergencyCosts.map((cost) => ({
      label: cost.label,
      amount: amountToInputValue(cost.amount),
    })),
  );
  const [multiplier, setMultiplier] = useState(String(settings.reserveMultiplier));
  const [busy, setBusy] = useState(false);

  function updateCost(index: number, patch: Partial<CostDraft>) {
    setCosts((prev) => prev.map((cost, i) => (i === index ? { ...cost, ...patch } : cost)));
  }

  async function handleSave() {
    setBusy(true);
    try {
      await run(() =>
        walletRepository.saveCashSettings({
          reserveAccountAmount: parseAmountInput(reserve),
          emergencyCosts: costs
            .map((cost) => ({ label: cost.label.trim(), amount: parseAmountInput(cost.amount) }))
            .filter((cost) => cost.label || cost.amount > 0),
          reserveMultiplier: Math.max(1, Number.parseInt(multiplier, 10) || 6),
        }),
      );
      showToast('Configurações salvas.');
    } catch {
      showToast('Não foi possível salvar. Tente de novo.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 px-4">
      <h2 className="text-muted text-sm font-semibold">Reserva e custos mensais</h2>
      <div className="border-border bg-card flex flex-col gap-4 rounded-xl border p-4 shadow-sm">
        {bankReserve && bankReserve.total !== null ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-muted text-sm font-medium">Reserva em conta</p>
            <p className="text-foreground text-base font-semibold tabular-nums">{formatBRL(bankReserve.total)}</p>
            <BankReserveLine reserve={bankReserve} now={now} />
          </div>
        ) : (
          <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
            Reserva em conta (R$)
            <input
              type="text"
              inputMode="decimal"
              value={reserve}
              onChange={(e) => setReserve(e.target.value)}
              className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
            />
          </label>
        )}
        {bankReserve && bankReserve.banks.length > 0 && (
          <BankReserveChooser reserve={bankReserve} onChange={onBankReserve} />
        )}

        <div className="flex flex-col gap-2">
          <p className="text-muted text-sm font-medium">Custo mensal se eu ficar sem renda</p>
          {costs.map((cost, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={cost.label}
                onChange={(e) => updateCost(index, { label: e.target.value })}
                placeholder="Ex.: Contas"
                aria-label={`Descrição do custo ${index + 1}`}
                className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-0 min-w-0 flex-1 rounded-md border px-3 outline-none focus:ring-2"
              />
              <input
                type="text"
                inputMode="decimal"
                value={cost.amount}
                onChange={(e) => updateCost(index, { amount: e.target.value })}
                placeholder="0,00"
                aria-label={`Valor do custo ${index + 1}`}
                className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-24 shrink-0 rounded-md border px-3 text-right outline-none focus:ring-2"
              />
              <button
                type="button"
                onClick={() => setCosts((prev) => prev.filter((_, i) => i !== index))}
                aria-label={`Remover custo ${index + 1}`}
                className="border-danger text-danger min-h-[44px] w-11 shrink-0 rounded-md border"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setCosts((prev) => [...prev, { label: '', amount: '' }])}
            className="border-border text-muted hover:text-foreground min-h-[44px] rounded-lg border border-dashed text-sm font-medium"
          >
            + Adicionar custo
          </button>
        </div>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Meses de reserva
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {busy ? 'Salvando…' : 'Salvar configuração'}
        </button>
      </div>
    </section>
  );
}

/** Where "Reserva em conta" comes from, and how fresh it is (a warning when a bank stopped). */
function BankReserveLine({ reserve, now }: { reserve: BankReserve; now: number }) {
  const line = reserveStatusLine(reserve, now);
  if (!line) return null;
  return <p className={`text-xs ${line.warning ? 'text-warning' : 'text-muted'}`}>{line.text}</p>;
}

/**
 * Open Finance: the person marks which accounts and investments are their reserve, from any bank
 * (nothing comes marked: the Capital doesn't guess which bank is the reserve), and can change it or
 * go back to typing the value at any time.
 */
function BankReserveChooser({
  reserve,
  onChange,
}: {
  reserve: BankReserve;
  onChange: (reserve: BankReserve) => void;
}) {
  const { run } = useWallet();
  const { showToast } = useToast();
  const fed = reserve.total !== null;
  const [open, setOpen] = useState(false);
  const [marked, setMarked] = useState<Set<string>>(() => markedIds(reserve));
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(accounts: string[], investments: string[], done: string) {
    setBusy(true);
    try {
      let next: BankReserve | null = null;
      await run(async () => {
        next = await banksRepository.setReserve(accounts, investments);
      });
      if (next) {
        onChange(next);
        setMarked(markedIds(next));
      }
      setOpen(false);
      showToast(done);
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível salvar. Tente de novo.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" onClick={() => setOpen(true)} className="text-primary text-sm font-semibold">
          {fed ? 'Mudar as contas da reserva' : 'Atualizar pelos bancos conectados'}
        </button>
        {fed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save([], [], 'Pronto: a reserva em conta volta a ser digitada.')}
            className="text-muted text-sm font-medium disabled:opacity-50"
          >
            Voltar a digitar à mão
          </button>
        )}
      </div>
    );
  }

  // An investment already redeemed (balance zero) is only noise, unless it is still marked.
  const offered = (source: ReserveSource) =>
    source.marked || source.kind === 'account' || (source.balance !== null && source.balance > 0);
  const hidden = reserve.banks
    .flatMap((bank) => bank.sources)
    .filter((source) => offered(source) && !source.usual && !source.marked).length;
  const toggle = (id: string) =>
    setMarked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pick = (kind: ReserveSource['kind']) =>
    reserve.banks.flatMap((bank) => bank.sources).filter((s) => s.kind === kind && marked.has(s.id)).map((s) => s.id);

  return (
    <form
      className="border-border flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save(pick('account'), pick('investment'), 'Pronto: a reserva em conta vem dos bancos.');
      }}
    >
      <p className="text-muted text-sm">Marque a sua reserva: o valor passa a vir daí.</p>
      {reserve.banks.map((bank) => {
        const sources = bank.sources.filter(
          (source) => offered(source) && (showAll || source.usual || source.marked),
        );
        if (sources.length === 0) return null;
        return (
          // min-w-0: a fieldset never shrinks below its content otherwise, and long names push the
          // amounts out of the sheet.
          <fieldset key={bank.itemId} className="flex min-w-0 flex-col gap-1">
            <legend className="text-foreground mb-1 text-sm font-semibold">{bank.name}</legend>
            {sources.map((source) => (
              <label key={source.id} className="flex min-h-[40px] items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={marked.has(source.id)}
                  onChange={() => toggle(source.id)}
                  className="accent-primary h-5 w-5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate">{source.name}</span>
                  <span className="text-muted block text-xs">{source.detail}</span>
                </span>
                {source.balance !== null && (
                  <span className="text-foreground shrink-0 tabular-nums">{formatBRL(source.balance)}</span>
                )}
              </label>
            ))}
          </fieldset>
        );
      })}
      {!showAll && hidden > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="text-primary self-start text-sm font-medium">
          Mostrar ações e fundos ({hidden})
        </button>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setMarked(markedIds(reserve));
            setOpen(false);
          }}
          className="border-border text-foreground min-h-[44px] flex-1 rounded-lg border text-sm font-medium"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={busy || marked.size === 0}
          className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Salvando…' : 'Usar estas'}
        </button>
      </div>
    </form>
  );
}

function markedIds(reserve: BankReserve): Set<string> {
  return new Set(
    reserve.banks.flatMap((bank) => bank.sources.filter((source) => source.marked).map((source) => source.id)),
  );
}
