'use client';

import { useState } from 'react';
import {
  createId,
  formatBRL,
  formatMonthLabel,
  parseAmountInput,
  quotasForAmount,
  todayISO,
  type InvestmentBucket,
  type TopicConfig,
} from '@/lib/budget';
import { isModuleOn } from '@/lib/modules';
import { walletRepository } from '@/lib/storage';
import { useSettings } from '@/components/providers/SettingsProvider';
import { AmountInput } from '@/components/ui/AmountInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import { useWallet } from '@/components/wallet/WalletProvider';

/** Quotas are fractional; show enough digits to recognise them without a wall of zeros. */
function formatQuotas(quotas: number): string {
  return quotas.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

const SOURCE_LABELS = { b3: 'B3', yahoo: 'Yahoo Finance' } as const;

function formatFetchedAt(iso: string | null): string {
  if (!iso) return 'sem cotação';
  const date = new Date(iso);
  return `${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/**
 * The "Investida" tab of the Reserva: the quotas of one asset, split into categorias da reserva.
 * "Guardar" buys quotas for one of them and charges the budget category it feeds, so it needs
 * Lançamentos; without it the tab still shows the quotas and lets the person buy or sell them.
 */
export function InvestedReserve() {
  const { settings } = useSettings();
  const { snapshot, month, run } = useWallet();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [trading, setTrading] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const [editingBucket, setEditingBucket] = useState<InvestmentBucket | 'new' | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (!snapshot) return null;

  const { investments } = snapshot;
  const topics = settings?.topics ?? [];
  const canAllocate = isModuleOn(settings, 'expenses');

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await run(() => walletRepository.refreshPrice());
      showToast('Cotação atualizada.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível atualizar a cotação.', 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDeleteBucket(bucket: InvestmentBucket) {
    const confirmed = await confirm({
      title: 'Excluir categoria da reserva',
      message: `As ${formatQuotas(bucket.quotas)} cotas de "${bucket.name}" ficam sem categoria.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) {
      showToast('Operação cancelada. Nenhuma alteração foi realizada.', 'info');
      return;
    }
    await run(() => walletRepository.deleteBucket(bucket.id));
    showToast('Categoria excluída da reserva.');
  }

  return (
    <div className="flex flex-col gap-3">
      <section
        data-tour="reserva-valor"
        className="border-border bg-card mx-4 flex flex-col gap-3 rounded-xl border p-4 shadow-sm"
      >
        <div>
          <p className="text-muted text-sm">Reserva investida</p>
          <p className="text-foreground text-2xl font-bold tabular-nums">
            {investments.price === null ? 'Sem cotação' : formatBRL(investments.totalValue)}
          </p>
          <p className="text-muted text-sm">
            {formatQuotas(investments.totalQuotas)} cotas de {investments.ticker}
            {investments.price !== null && investments.buckets.length > 0
              ? ` · ${formatBRL(investments.freeValue)} sem categoria`
              : ''}
          </p>
        </div>

        {investments.stale && investments.price !== null && (
          <p className="bg-warning-bg text-warning rounded-lg px-3 py-2 text-xs">
            Essa cotação está velha. Atualize antes de guardar ou retirar.
          </p>
        )}

        <div className="flex gap-2">
          {canAllocate && (
            <button
              type="button"
              onClick={() => setAllocating(true)}
              disabled={investments.price === null || investments.buckets.length === 0}
              className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
            >
              Guardar / Retirar
            </button>
          )}
          <button
            type="button"
            onClick={() => setTrading(true)}
            className={
              canAllocate
                ? 'border-border text-foreground min-h-[44px] flex-1 rounded-lg border px-3 text-sm font-medium'
                : 'bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold'
            }
          >
            Comprar ou vender
          </button>
        </div>
        {investments.price === null && canAllocate && (
          <p className="text-muted text-xs">
            Sem cotação não dá para guardar nem retirar: atualize primeiro.
          </p>
        )}

        <div className="border-border flex items-center justify-between gap-2 border-t pt-3">
          <p className="text-muted min-w-0 text-xs">
            {investments.assetName && <span className="block truncate">{investments.assetName}</span>}
            {investments.price === null
              ? 'Sem cotação ainda'
              : `${formatBRL(investments.price)} por cota · ${formatFetchedAt(investments.fetchedAt)}`}
            {investments.source && ` · ${SOURCE_LABELS[investments.source]}`}
          </p>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            data-tour="reserva-cotacao"
            className="border-border text-foreground min-h-[36px] shrink-0 rounded-lg border px-3 text-sm font-medium disabled:opacity-50"
          >
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2 px-4" data-tour="reserva-categorias">
        <div className="flex items-center justify-between">
          <h2 className="text-muted text-sm font-semibold">Categorias da reserva</h2>
          {canAllocate && (
            <button
              type="button"
              onClick={() => setEditingBucket('new')}
              className="text-primary min-h-[36px] text-sm font-medium"
            >
              + Nova categoria
            </button>
          )}
        </div>

        <ul className="flex flex-col gap-2">
          {investments.buckets.map((bucket) => (
            <li
              key={bucket.id}
              className="border-border bg-card flex items-center gap-3 rounded-xl border px-4 py-3 shadow-sm"
            >
              <button
                type="button"
                onClick={() => setEditingBucket(bucket)}
                disabled={!canAllocate}
                className="min-w-0 flex-1 text-left"
              >
                <span className="text-foreground block truncate font-medium">{bucket.name}</span>
                <span className="text-muted block text-xs">
                  {formatQuotas(bucket.quotas)} cotas ·{' '}
                  {topics.find((topic) => topic.id === bucket.topicId)?.name ?? 'sem categoria'}
                </span>
              </button>
              <span className="text-foreground shrink-0 font-semibold">{formatBRL(bucket.value)}</span>
              {canAllocate && (
                <button
                  type="button"
                  onClick={() => void handleDeleteBucket(bucket)}
                  className="text-danger min-h-[36px] shrink-0 text-xs font-medium"
                >
                  Excluir
                </button>
              )}
            </li>
          ))}
        </ul>

        {!canAllocate ? null : (
          investments.buckets.length === 0 && (
            <p className="text-muted py-6 text-center text-sm">
              Nenhuma categoria ainda. O que não estiver numa fica sem categoria.
            </p>
          )
        )}
      </section>

      {trading && (
        <TradeSheet
          ticker={investments.ticker}
          totalQuotas={investments.totalQuotas}
          onClose={() => setTrading(false)}
          onSave={async (delta) => {
            try {
              await run(() => walletRepository.tradeQuotas(delta));
              setTrading(false);
              showToast('Operação realizada com sucesso!');
            } catch (err) {
              showToast(err instanceof Error ? err.message : 'Não foi possível salvar.', 'error');
            }
          }}
        />
      )}

      {allocating && investments.price !== null && (
        <AllocateSheet
          buckets={investments.buckets}
          price={investments.price}
          month={month}
          onClose={() => setAllocating(false)}
          onSave={async (bucketId, amount, direction) => {
            try {
              await run(() =>
                walletRepository.allocate({ bucketId, amount, direction, month, date: todayISO() }),
              );
              setAllocating(false);
              showToast(
                direction === 'out'
                  ? 'Retirado: o valor ficou sem categoria.'
                  : 'Guardado: virou um gasto na categoria do mês.',
              );
            } catch (err) {
              showToast(
                err instanceof Error ? err.message : 'Não foi possível salvar. Tente de novo.',
                'error',
              );
            }
          }}
        />
      )}

      {editingBucket && (
        <BucketFormSheet
          topics={topics}
          initial={editingBucket === 'new' ? undefined : editingBucket}
          onClose={() => setEditingBucket(null)}
          onSave={async (bucket) => {
            try {
              await run(() => walletRepository.saveBucket(bucket));
              setEditingBucket(null);
              showToast('Operação concluída com sucesso!');
            } catch {
              showToast('Não foi possível salvar. Tente de novo.', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

/** Which ticker the reserve follows. Changing it starts the price cache over for that code. */
export function TickerSection({ ticker }: { ticker: string }) {
  const { run } = useWallet();
  const { showToast } = useToast();
  const [value, setValue] = useState(ticker);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await run(() => walletRepository.setTicker(value));
      showToast('Ativo atualizado. Atualize a cotação para ver o valor.');
    } catch {
      showToast('Não foi possível salvar o ativo.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 px-4">
      <h2 className="text-muted text-sm font-semibold">Ativo da reserva</h2>
      <div className="border-border bg-card flex items-end gap-2 rounded-xl border p-4 shadow-sm">
        <label className="text-muted flex min-w-0 flex-1 flex-col gap-1 text-sm">
          Código na bolsa
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-full rounded-md border px-3 uppercase outline-none focus:ring-2"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy || value.trim() === ticker}
          className="border-border text-foreground min-h-[44px] shrink-0 rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
        >
          Salvar
        </button>
      </div>
    </section>
  );
}

function TradeSheet({
  ticker,
  totalQuotas,
  onClose,
  onSave,
}: {
  ticker: string;
  totalQuotas: number;
  onClose: () => void;
  onSave: (delta: number) => Promise<void>;
}) {
  const [operation, setOperation] = useState<'buy' | 'sell'>('buy');
  const [quotas, setQuotas] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = parseAmountInput(quotas);

  return (
    <BottomSheet open title={`Comprar ou vender ${ticker}`} onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!(parsed > 0)) return;
          setSaving(true);
          try {
            await onSave(operation === 'buy' ? parsed : -parsed);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="flex gap-2">
          {(
            [
              ['buy', 'Comprar'],
              ['sell', 'Vender'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOperation(value)}
              className={`min-h-[44px] flex-1 rounded-lg border px-3 text-sm font-medium ${
                operation === value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Quantidade de cotas
          <input
            type="text"
            inputMode="decimal"
            value={quotas}
            onChange={(e) => setQuotas(e.target.value)}
            autoFocus
            placeholder="0"
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>

        <p className="text-muted text-sm">
          Você tem {formatQuotas(totalQuotas)} cotas. Depois desta operação:{' '}
          {formatQuotas(operation === 'buy' ? totalQuotas + parsed : totalQuotas - parsed)}.
        </p>

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

/**
 * Moving money between the free reserve and a categoria, in both directions. "Guardar" buys
 * quotas for the categoria and charges the category it feeds; "Retirar" is the same thing
 * backwards — the quotas go back to the free reserve and the month receives an estorno, so it
 * stops showing an expense the person undid.
 */
function AllocateSheet({
  buckets,
  price,
  month,
  onClose,
  onSave,
}: {
  buckets: { id: string; name: string; quotas: number; value: number }[];
  price: number;
  month: string;
  onClose: () => void;
  onSave: (bucketId: string, amount: number, direction: 'in' | 'out') => Promise<void>;
}) {
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [bucketId, setBucketId] = useState(buckets[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = parseAmountInput(amount);
  const bucket = buckets.find((item) => item.id === bucketId);
  const out = direction === 'out';
  // A categoria só entrega o que tem, e o que ela tem são cotas.
  const tooMuch = out && !!bucket && quotasForAmount(parsed, price) > bucket.quotas;

  return (
    <BottomSheet open title="Guardar ou retirar" onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!bucketId || !(parsed > 0) || tooMuch) return;
          setSaving(true);
          try {
            await onSave(bucketId, parsed, direction);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="flex gap-2">
          {(
            [
              ['in', 'Guardar'],
              ['out', 'Retirar'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDirection(value)}
              className={`min-h-[44px] flex-1 rounded-lg border px-3 text-sm font-medium ${
                direction === value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <AmountInput value={amount} onChange={setAmount} autoFocus />

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Categoria da reserva
          <select
            value={bucketId}
            onChange={(e) => setBucketId(e.target.value)}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          >
            {buckets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {bucket && (
            <span className="text-muted text-xs">
              Tem {formatBRL(bucket.value)} guardados ({formatQuotas(bucket.quotas)} cotas).
            </span>
          )}
        </label>

        <p className="text-muted text-sm">
          {parsed > 0
            ? `São ${formatQuotas(quotasForAmount(parsed, price))} cotas a ${formatBRL(price)}. `
            : ''}
          {out
            ? `As cotas ficam sem categoria; a devolução entra em ${formatMonthLabel(month)}.`
            : `Vira um gasto na categoria do orçamento, em ${formatMonthLabel(month)}.`}
        </p>

        {tooMuch && bucket && (
          <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">
            {bucket.name} só tem {formatBRL(bucket.value)} guardados.
          </p>
        )}

        <button
          type="submit"
          disabled={saving || !(parsed > 0) || tooMuch}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Confirmar'}
        </button>
      </form>
    </BottomSheet>
  );
}

function BucketFormSheet({
  topics,
  initial,
  onClose,
  onSave,
}: {
  topics: TopicConfig[];
  initial?: InvestmentBucket;
  onClose: () => void;
  onSave: (bucket: InvestmentBucket) => Promise<void>;
}) {
  const activeTopics = topics.filter((t) => !t.archived).sort((a, b) => a.order - b.order);
  const [name, setName] = useState(initial?.name ?? '');
  const [topicId, setTopicId] = useState(initial?.topicId ?? activeTopics[0]?.id ?? '');
  const [quotas, setQuotas] = useState(initial ? String(initial.quotas) : '0');
  const [saving, setSaving] = useState(false);
  const parsedQuotas = parseAmountInput(quotas);

  return (
    <BottomSheet
      open
      title={initial ? 'Editar categoria da reserva' : 'Nova categoria da reserva'}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || !topicId) return;
          setSaving(true);
          try {
            await onSave({
              id: initial?.id ?? createId(),
              name: name.trim(),
              topicId,
              quotas: Math.max(0, parsedQuotas),
            });
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Nome
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!initial}
            placeholder="Ex.: Metas, Conhecimento..."
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Categoria do orçamento que ela alimenta
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          >
            {activeTopics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>
          <span className="text-muted text-xs">
            Guardar aqui lança o gasto na categoria do orçamento.
          </span>
        </label>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Cotas guardadas
          <input
            type="text"
            inputMode="decimal"
            value={quotas}
            onChange={(e) => setQuotas(e.target.value)}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>

        <button
          type="submit"
          disabled={saving || !name.trim() || !topicId}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </BottomSheet>
  );
}
