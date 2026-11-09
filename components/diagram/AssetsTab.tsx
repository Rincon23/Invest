'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Landmark, ListChecks, Plus, RefreshCw, Search } from 'lucide-react';
import {
  bankNames,
  checkHoldings,
  holdingsStatusLine,
  type AssetCheck,
  type BankHoldings,
  type BankOnlyHolding,
} from '@/lib/banks';
import { amountToInputValue, formatBRL, parseAmountInput, todayISO } from '@/lib/budget';
import {
  assetType,
  assetValue,
  fixedIncomeAmount,
  formatScore,
  isFixedIncomeType,
  scoreOf,
  typesInUse,
  UNQUOTED_LABEL,
  type AssetType,
  type DiagramAsset,
  type DiagramOverview,
  type FixedIncomeType,
} from '@/lib/diagram';
import { diagramRepository } from '@/lib/storage';
import { AmountInput } from '@/components/ui/AmountInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useToast } from '@/components/ui/Toast';
import { DirectScoreField } from './AssetSheet';
import { formatDate, formatWhen, pct, quotasLabel } from './format';
import { PortfolioChart } from './PortfolioCard';
import { TypeChips } from './TypeChips';

/** Past this many assets the list gets a search field. */
const SEARCH_FROM = 8;
/** Past this many, "No banco, mas não no Diagrama" starts folded (a broker can hold dozens). */
const ONLY_BANK_OPEN_UP_TO = 3;

/** The oldest price on screen: what "Cotações de …" says. */
function oldestQuote(overview: DiagramOverview): string | null {
  const times = Object.values(overview.quotes).map((quote) => quote.fetchedAt);
  return times.length > 0 ? times.reduce((oldest, time) => (time < oldest ? time : oldest)) : null;
}

/** The score as a small coloured pill. */
function ScorePill({ score, muted }: { score: number | null; muted?: boolean }) {
  const tone =
    muted || score === null
      ? 'bg-background text-muted'
      : score > 0
        ? 'bg-success-bg text-success'
        : 'bg-danger-bg text-danger';
  return (
    <span
      className={`min-w-[2.75rem] shrink-0 rounded-full px-2 py-1 text-center text-sm font-semibold tabular-nums ${tone}`}
    >
      {formatScore(score)}
    </span>
  );
}

/** A bank's quantity as it is, fractions included ("120", "10,5"). */
function shares(quantity: number): string {
  return quantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 });
}

/**
 * Under an asset, what the banks hold of it: "✓ Confere com BTG Pactual", or "BTG Pactual: 120 ·
 * aqui: 100" with "Usar 120". Nothing changes until the person taps.
 */
function BankCheckLine({
  check,
  saving,
  onUse,
}: {
  check: AssetCheck;
  saving: boolean;
  onUse: (quantity: number) => void;
}) {
  const where = bankNames(check.banks);
  const reserve = check.reserve > 0 ? ` (${shares(check.reserve)} na Reserva)` : '';
  if (check.status === 'match') {
    return (
      <p className="text-success -mt-1.5 flex items-center gap-1 px-4 pb-2 text-xs">
        <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          Confere com {where}
          {reserve}
        </span>
      </p>
    );
  }
  return (
    <div className="-mt-1.5 flex items-center gap-2 px-4 pb-2 text-xs">
      <p className="text-warning min-w-0 flex-1">
        {where}: {shares(check.bank)} · aqui: {shares(check.capital)}
        {reserve}
        {check.related.length > 0 && (
          <span className="text-muted block">
            No banco tem {check.related.map((item) => `${item.ticker}: ${shares(item.bank)}`).join(', ')}.
          </span>
        )}
      </p>
      {check.use !== null ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => check.use !== null && onUse(check.use)}
          className="border-border text-primary min-h-[32px] shrink-0 rounded-lg border px-2.5 font-semibold disabled:opacity-50"
        >
          {saving
            ? 'Salvando…'
            : check.reserve > 0
              ? `Deixar ${shares(check.use)} aqui`
              : `Usar ${shares(check.use)}`}
        </button>
      ) : check.reserve > 0 ? (
        <Link href="/carteira/caixa?aba=investida" className="text-primary shrink-0 font-semibold">
          Ver a Reserva
        </Link>
      ) : (
        <span className="text-muted shrink-0">Em 2 tipos: ajuste na ficha</span>
      )}
    </div>
  );
}

/** One line of the list: what it is, what it is worth, its score (and, below, `footer`). */
function Row({
  title,
  badge,
  subtitle,
  value,
  score,
  stopped,
  onClick,
  footer,
}: {
  title: string;
  badge?: string;
  subtitle?: string;
  value: string;
  score: number | null;
  stopped?: boolean;
  onClick: () => void;
  footer?: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span
            className={`flex items-center gap-1.5 font-semibold ${stopped ? 'text-muted' : 'text-foreground'}`}
          >
            <span className="truncate">{title}</span>
            {badge && (
              <span className="bg-background text-muted rounded px-1.5 py-0.5 text-[10px] font-semibold">
                {badge}
              </span>
            )}
          </span>
          {(subtitle || stopped) && (
            <span className="text-muted block truncate text-xs">
              {stopped ? 'Não compro mais' : subtitle}
              {stopped && subtitle ? ` · ${subtitle}` : ''}
            </span>
          )}
        </span>
        <span className="text-foreground shrink-0 text-sm tabular-nums">{value}</span>
        <ScorePill score={score} muted={stopped} />
      </button>
      {footer}
    </li>
  );
}

/**
 * Above the list, with Open Finance: when the banks' data is from and why nothing changes by
 * itself, the differences, and what the banks hold that the Diagrama doesn't ("Adicionar").
 */
function BanksCheckCard({
  holdings,
  check,
  differing,
  onlyDifferent,
  onToggleDifferent,
  onAdd,
}: {
  holdings: BankHoldings;
  check: ReturnType<typeof checkHoldings>;
  differing: number;
  onlyDifferent: boolean;
  onToggleDifferent: () => void;
  onAdd: (item: BankOnlyHolding) => void;
}) {
  const [now] = useState(() => Date.now());
  const [showOnlyBank, setShowOnlyBank] = useState(check.onlyBank.length <= ONLY_BANK_OPEN_UP_TO);
  const status = holdingsStatusLine(holdings.banks, check.banks, now);
  const above = check.reserveAbove;
  return (
    <section className="border-border bg-card mx-4 flex flex-col gap-2 rounded-xl border p-3 shadow-sm">
      <p className="text-muted flex gap-2 text-xs">
        <Landmark aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {status && (
            <span className={status.warning ? 'text-warning' : 'text-foreground'}>{status.text}. </span>
          )}
          Uma compra leva uns 2 dias úteis para aparecer (liquidação na B3), por isso nada muda sozinho.
        </span>
      </p>
      {differing === 0 && check.onlyBank.length === 0 && !above && (
        <p className="text-success flex items-center gap-1 text-sm font-semibold">
          <Check aria-hidden className="h-4 w-4 shrink-0" />
          Tudo confere com {bankNames(check.banks)}.
        </p>
      )}
      {(differing > 0 || onlyDifferent) && (
        <button
          type="button"
          onClick={onToggleDifferent}
          aria-pressed={onlyDifferent}
          className="text-primary self-start text-sm font-semibold"
        >
          {onlyDifferent
            ? 'Ver todos os ativos'
            : differing === 1
              ? 'Ver só o ativo diferente do banco'
              : `Ver só os ${differing} ativos diferentes do banco`}
        </button>
      )}
      {check.onlyBank.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setShowOnlyBank((open) => !open)}
            aria-expanded={showOnlyBank}
            className="text-foreground flex min-h-[36px] items-center gap-1 self-start text-sm font-semibold"
          >
            <ChevronDown
              aria-hidden
              className={`h-4 w-4 transition-transform ${showOnlyBank ? 'rotate-180' : ''}`}
            />
            No banco, mas não no Diagrama ({check.onlyBank.length})
          </button>
          {showOnlyBank && (
            <ul className="divide-border divide-y">
              {check.onlyBank.map((item) => (
                <li key={item.ticker} className="flex min-h-[48px] items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block text-sm font-semibold">{item.ticker}</span>
                    <span className="text-muted block truncate text-xs">
                      {bankNames(item.banks)}: {shares(item.bank)}
                      {item.reserve > 0 ? ` (${shares(item.reserve)} na Reserva)` : ''}
                      {item.name && item.name !== item.ticker ? ` · ${item.name}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onAdd(item)}
                    className="border-border text-primary min-h-[36px] shrink-0 rounded-lg border px-3 text-sm font-semibold"
                  >
                    Adicionar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {above && (
        <p className="text-muted text-xs">
          Reserva investida: {shares(above.reserve)} cotas de {above.ticker} · {bankNames(above.banks)}:{' '}
          {shares(above.bank)}.{' '}
          <Link href="/carteira/caixa?aba=investida" className="text-primary font-semibold">
            Ver a Reserva
          </Link>
        </p>
      )}
    </section>
  );
}

/**
 * "Ativos e notas": the portfolio by type, the filters and, per type, one card with a line per
 * asset (value and score; "Não compro mais" and the rest live in the asset's sheet). Fixed income
 * has its total without a quote (Tesouro, CDB, LCI…) plus the funds with a ticker (DEBB11).
 */
export function AssetsTab({
  overview,
  holdings,
  checkBanks,
  onOpenAsset,
  onAddAsset,
  onAddFromBank,
  onOpenQuestions,
  onOpenTargets,
  onChanged,
}: {
  overview: DiagramOverview;
  /** What the banks hold (Open Finance on, VIP); null hides every comparison. */
  holdings: BankHoldings | null;
  /** Came from "Conferir investimentos" (Open Finance): only what differs, the check in view. */
  checkBanks?: boolean;
  onOpenAsset: (asset: DiagramAsset) => void;
  onAddAsset: () => void;
  onAddFromBank: (item: BankOnlyHolding) => void;
  onOpenQuestions: () => void;
  onOpenTargets: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [filter, setFilter] = useState<AssetType | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [editingFixed, setEditingFixed] = useState<FixedIncomeType | null>(null);
  const [onlyDifferent, setOnlyDifferent] = useState(!!checkBanks);
  const checkRef = useRef<HTMLDivElement>(null);
  /** The asset whose quantity is being taken from the bank. */
  const [usingBank, setUsingBank] = useState<string | null>(null);

  const inUse = typesInUse(overview.settings.targets);
  const search = query.trim().toUpperCase();
  const visibleTypes = inUse.filter((type) => filter === null || filter === type);
  const hidden = overview.assets.filter((asset) => !inUse.includes(asset.type)).length;
  const quotedAt = oldestQuote(overview);
  const check = holdings ? checkHoldings(holdings, overview.assets) : null;
  const differs = (asset: DiagramAsset) =>
    !!check?.assets[asset.id] && check.assets[asset.id].status !== 'match';
  const differing = overview.assets.filter((asset) => inUse.includes(asset.type) && differs(asset)).length;
  // Once the last difference is fixed, the whole list comes back.
  const showOnlyDifferent = onlyDifferent && differing > 0;

  // "Conferir investimentos": the check comes into view once the banks' answer is here.
  const scrolledToCheck = useRef(false);
  useEffect(() => {
    if (!checkBanks || !holdings || scrolledToCheck.current) return;
    scrolledToCheck.current = true;
    checkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [checkBanks, holdings]);

  /** "Usar 120": the bank's quantity, saved like the asset's own sheet saves it. */
  async function applyBankQuantity(asset: DiagramAsset, quantity: number) {
    setUsingBank(asset.id);
    try {
      await diagramRepository.updateAsset(
        asset.id,
        {
          type: asset.type,
          ticker: asset.ticker,
          quantity,
          sector: asset.sector ?? null,
          subsector: asset.subsector ?? null,
          note: asset.note ?? null,
          stopBuying: asset.stopBuying,
          isEtf: asset.isEtf,
          directScore: asset.directScore,
        },
        todayISO(),
      );
      await onChanged();
      showToast(`${asset.ticker}: ${shares(quantity)} ${quantity === 1 ? 'cota' : 'cotas'}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível salvar.', 'error');
    } finally {
      setUsingBank(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const { missing } = await diagramRepository.refreshQuotes();
      await onChanged();
      showToast(
        missing.length > 0 ? `Sem cotação agora: ${missing.join(', ')}.` : 'Cotações atualizadas.',
        missing.length > 0 ? 'info' : 'success',
      );
    } catch {
      showToast('Não foi possível atualizar as cotações.', 'error');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
        <PortfolioChart overview={overview} />
        {inUse.length === 0 && (
          <button
            type="button"
            onClick={onOpenTargets}
            className="text-primary self-start text-sm font-semibold"
          >
            Escolher tipos e metas
          </button>
        )}
      </section>

      <div className="flex items-center gap-2 px-4">
        <button
          type="button"
          onClick={onAddAsset}
          className="bg-primary text-primary-foreground flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Ativo
        </button>
        <button
          type="button"
          onClick={onOpenQuestions}
          data-tour="diagrama-perguntas"
          className="border-border text-foreground flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 text-sm font-medium"
        >
          <ListChecks aria-hidden className="h-4 w-4" />
          Perguntas
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || overview.assets.length === 0}
          aria-label="Atualizar cotações"
          title={quotedAt ? `Cotações de ${formatWhen(quotedAt)}` : 'Atualizar cotações'}
          className="text-muted ml-auto flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-xs disabled:opacity-40"
        >
          {quotedAt && <span className="tabular-nums">{formatWhen(quotedAt)}</span>}
          <RefreshCw aria-hidden className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div ref={checkRef} className="flex scroll-mt-20 flex-col">
        {holdings && check && check.banks.length > 0 ? (
          <BanksCheckCard
            holdings={holdings}
            check={check}
            differing={differing}
            onlyDifferent={showOnlyDifferent}
            onToggleDifferent={() => setOnlyDifferent(!showOnlyDifferent)}
            onAdd={onAddFromBank}
          />
        ) : (
          holdings &&
          checkBanks && (
            <p className="border-border bg-card text-muted mx-4 rounded-xl border p-3 text-sm shadow-sm">
              As quantidades chegam na próxima leitura dos bancos.
            </p>
          )
        )}
      </div>

      {inUse.length > 1 && (
        <div className="px-4">
          <TypeChips
            types={inUse}
            selected={filter}
            onSelect={setFilter}
            all={{ label: 'Todos', onSelect: () => setFilter(null) }}
          />
        </div>
      )}

      {overview.assets.length > SEARCH_FROM && (
        <label className="border-border bg-card focus-within:ring-primary mx-4 flex min-h-[44px] items-center gap-2 rounded-lg border px-3 focus-within:ring-2">
          <Search aria-hidden className="text-muted h-4 w-4" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar ativo"
            className="text-foreground w-full bg-transparent text-base outline-none"
          />
        </label>
      )}

      <section className="flex flex-col gap-4 px-4" data-tour="diagrama-ativos">
        {visibleTypes.map((type) => {
          const definition = assetType(type);
          const fixed = isFixedIncomeType(type);
          const assets = overview.assets
            .filter((asset) => asset.type === type)
            .filter(
              (asset) =>
                !search ||
                asset.ticker.includes(search) ||
                (overview.quotes[asset.id]?.name ?? '').toUpperCase().includes(search),
            )
            .filter((asset) => !showOnlyDifferent || differs(asset));
          const showUnquoted =
            fixed && !showOnlyDifferent && (!search || UNQUOTED_LABEL.toUpperCase().includes(search));
          if ((search || showOnlyDifferent) && assets.length === 0 && !showUnquoted) return null;

          const unquoted = fixed ? fixedIncomeAmount(overview, type as FixedIncomeType) : 0;
          const inType =
            unquoted +
            overview.assets
              .filter((asset) => asset.type === type)
              .reduce((sum, asset) => sum + assetValue(asset, overview), 0);
          const total = overview.fixedIncome.find((item) => item.type === type);
          return (
            <div key={type} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: definition.color }}
                />
                <h3 className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold">
                  {definition.label}
                </h3>
                <span className="text-muted text-xs tabular-nums">
                  {inType > 0 ? `${formatBRL(inType)} · ` : ''}meta{' '}
                  {pct(overview.settings.targets[type] ?? 0)}
                </span>
              </div>
              {assets.length === 0 && !showUnquoted ? (
                <p className="text-muted px-1 text-sm">Nenhum ativo ainda.</p>
              ) : (
                <ul className="border-border bg-card divide-border divide-y rounded-xl border shadow-sm">
                  {showUnquoted && (
                    <Row
                      title={UNQUOTED_LABEL}
                      subtitle={
                        total?.updatedOn
                          ? `Tesouro, CDB, LCI… · ${formatDate(total.updatedOn)}`
                          : 'Tesouro, CDB, LCI…'
                      }
                      value={formatBRL(unquoted)}
                      score={total?.score ?? 1}
                      onClick={() => setEditingFixed(type as FixedIncomeType)}
                    />
                  )}
                  {assets.map((asset) => {
                    const quote = overview.quotes[asset.id];
                    const value = assetValue(asset, overview);
                    const parts = [
                      asset.quantity > 0 ? quotasLabel(asset.quantity, asset.type) : '',
                      value > 0 && inType > 0 ? `${pct(value / inType)} do tipo` : '',
                      quote ? '' : 'sem cotação',
                    ].filter(Boolean);
                    return (
                      <Row
                        key={asset.id}
                        title={asset.ticker}
                        badge={asset.isEtf && !fixed ? 'ETF' : undefined}
                        subtitle={parts.join(' · ') || undefined}
                        value={value > 0 ? formatBRL(value) : '—'}
                        score={scoreOf(asset, overview).score}
                        stopped={asset.stopBuying}
                        onClick={() => onOpenAsset(asset)}
                        footer={
                          check?.assets[asset.id] && (
                            <BankCheckLine
                              check={check.assets[asset.id]}
                              saving={usingBank === asset.id}
                              onUse={(quantity) => void applyBankQuantity(asset, quantity)}
                            />
                          )
                        }
                      />
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}

        {inUse.length > 0 && overview.assets.length === 0 && (
          <p className="text-muted text-center text-sm">Nenhum ativo ainda. Toque em + Ativo.</p>
        )}
        {hidden > 0 && (
          <p className="text-muted text-xs">
            {hidden === 1 ? '1 ativo guardado' : `${hidden} ativos guardados`} em tipos fora da carteira.{' '}
            <button type="button" onClick={onOpenTargets} className="text-primary font-semibold">
              Tipos e metas
            </button>
          </p>
        )}
      </section>

      {editingFixed && (
        <FixedIncomeSheet
          overview={overview}
          type={editingFixed}
          onClose={() => setEditingFixed(null)}
          onSaved={async () => {
            await onChanged();
            setEditingFixed(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * What a fixed-income type holds without a quote (Tesouro Direto, CDB, LCI, LCA…), summed up, and
 * its score — how it shares the type with the funds that have a ticker.
 */
export function FixedIncomeSheet({
  overview,
  type,
  onClose,
  onSaved,
}: {
  overview: DiagramOverview;
  type: FixedIncomeType;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const current = overview.fixedIncome.find((item) => item.type === type);
  const [amount, setAmount] = useState(current ? amountToInputValue(current.amount) : '');
  const [score, setScore] = useState(current?.score ?? 1);
  const [saving, setSaving] = useState(false);

  return (
    <BottomSheet open title={`${UNQUOTED_LABEL} · ${assetType(type).shortLabel}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            await diagramRepository.setFixedIncome(
              type,
              Math.max(0, parseAmountInput(amount)),
              todayISO(),
              score,
            );
            await onSaved();
            showToast('Salvo.');
          } catch {
            showToast('Não foi possível salvar.', 'error');
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="text-muted text-sm">
          Tesouro, CDB, LCI, LCA: o que não tem cotação.
        </p>
        <AmountInput value={amount} onChange={setAmount} autoFocus label="Valor total" />
        {current?.updatedOn && (
          <p className="text-muted -mt-2 text-xs">Atualizado em {formatDate(current.updatedOn)}.</p>
        )}
        <DirectScoreField value={score} onChange={(value) => setScore(Math.round(value * 100) / 100)} />
        <button
          type="submit"
          disabled={saving}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </BottomSheet>
  );
}
