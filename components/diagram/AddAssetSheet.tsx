'use client';

import { useEffect, useRef, useState } from 'react';
import type { BankOnlyHolding } from '@/lib/banks';
import { parseAmountInput, todayISO } from '@/lib/budget';
import {
  assetType,
  isFixedIncomeType,
  UNQUOTED_LABEL,
  normalizeAssetTicker,
  typesInUse,
  type DiagramAsset,
  type DiagramOverview,
  type AssetType,
} from '@/lib/diagram';
import { diagramRepository, type TickerSuggestion } from '@/lib/storage';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { quantityText } from './AssetSheet';

/** How long the field waits after the last key before asking for suggestions. */
const SEARCH_DELAY_MS = 300;

/**
 * "Adicionar ativo": first the type (the chips of the portfolio's types), then the ticker with
 * suggestions while typing, and the quantity. The answers come next, in the asset's own sheet,
 * which opens right after. From the banks ("No banco, mas não no Diagrama") the ticker and the
 * quantity come filled in; the type too, when the bank's kind says it (an ETF the person picks).
 */
export function AddAssetSheet({
  overview,
  initialType,
  fromBank,
  onClose,
  onAdded,
}: {
  overview: DiagramOverview;
  initialType?: AssetType;
  fromBank?: BankOnlyHolding;
  onClose: () => void;
  onAdded: (asset: DiagramAsset) => Promise<void>;
}) {
  const { showToast } = useToast();
  const types = typesInUse(overview.settings.targets);
  const [type, setType] = useState<AssetType | null>(() => {
    if (fromBank) return fromBank.type && types.includes(fromBank.type) ? fromBank.type : null;
    return initialType && types.includes(initialType) ? initialType : (types[0] ?? null);
  });
  const [ticker, setTicker] = useState(fromBank?.ticker ?? '');
  const [quantity, setQuantity] = useState(fromBank ? quantityText(fromBank.quantity) : '');
  const [isEtf, setIsEtf] = useState(fromBank?.isEtf ?? false);
  // With the type unknown the search still runs once the person picks one: it brings the name and
  // whether it is an ETF, which the bank doesn't say.
  const [chosen, setChosen] = useState<TickerSuggestion | null>(
    fromBank?.type
      ? {
          ticker: fromBank.ticker,
          name: fromBank.name && fromBank.name !== fromBank.ticker ? fromBank.name : undefined,
          isEtf: fromBank.isEtf,
        }
      : null,
  );
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const request = useRef(0);

  const market = type ? (assetType(type).market) : 'b3';
  const normalized = type ? normalizeAssetTicker(market, ticker) : '';

  useEffect(() => {
    if (!type || normalized.length < 1 || chosen?.ticker === normalized) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions([]);
      return;
    }
    const id = ++request.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await diagramRepository.searchTickers(type, normalized);
        if (request.current === id) setSuggestions(found);
      } catch {
        if (request.current === id) setSuggestions([]);
      } finally {
        if (request.current === id) setSearching(false);
      }
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [type, normalized, chosen]);

  function choose(suggestion: TickerSuggestion) {
    setChosen(suggestion);
    setTicker(suggestion.ticker);
    setIsEtf(suggestion.isEtf);
    setSuggestions([]);
  }

  const duplicate = !!type && overview.assets.some((asset) => asset.type === type && asset.ticker === normalized);

  if (types.length === 0) {
    return (
      <BottomSheet open title="Adicionar ativo" onClose={onClose}>
        <p className="text-muted text-sm">
          Primeiro escolha os tipos da sua carteira na engrenagem (Tipos e metas).
        </p>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet open title="Adicionar ativo" onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!type || !normalized || duplicate) return;
          setSaving(true);
          try {
            const asset = await diagramRepository.addAsset(
              {
                type,
                ticker: normalized,
                quantity: Math.max(0, parseAmountInput(quantity)),
                stopBuying: false,
                isEtf,
                directScore: null,
              },
              todayISO(),
            );
            await onAdded(asset);
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Não foi possível adicionar.', 'error');
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="text-muted text-sm font-medium">
            {fromBank && !type ? `Tipo: em qual deles entra ${fromBank.ticker}?` : 'Tipo'}
          </span>
          <div className="flex flex-wrap gap-2">
            {types.map((key) => {
              const definition = assetType(key);
              const selected = key === type;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setType(key);
                    // A B3 code from the bank fits any type: no need to search it again.
                    setChosen((current) => (fromBank && current?.ticker === fromBank.ticker ? current : null));
                  }}
                  className={`flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${
                    selected ? 'text-foreground' : 'border-border text-muted'
                  }`}
                  style={selected ? { borderColor: definition.color, background: `color-mix(in srgb, ${definition.color} 14%, transparent)` } : undefined}
                >
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: definition.color }} />
                  {definition.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative flex flex-col gap-1.5">
          <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
            Código do ativo
            <input
              type="text"
              value={ticker}
              onChange={(event) => {
                setTicker(event.target.value.toUpperCase());
                setChosen(null);
              }}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={type ? `Ex.: ${assetType(type).example}` : ''}
              className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base uppercase outline-none focus:ring-2"
            />
          </label>
          {chosen?.name && <p className="text-muted text-xs">{chosen.name}</p>}
          {duplicate && <p className="text-danger text-xs">{normalized} já está na sua carteira, nesse tipo.</p>}
          {suggestions.length > 0 && (
            <ul className="border-border bg-card flex flex-col overflow-hidden rounded-lg border" role="listbox">
              {suggestions.map((suggestion) => (
                <li key={suggestion.ticker}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => choose(suggestion)}
                    className="hover:bg-background flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span className="text-foreground font-semibold">{suggestion.ticker}</span>
                    <span className="text-muted min-w-0 flex-1 truncate text-xs">{suggestion.name}</span>
                    {suggestion.isEtf && (
                      <span className="bg-background text-muted rounded-full px-2 py-0.5 text-[10px] font-semibold">ETF</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searching && suggestions.length === 0 && normalized && !chosen && (
            <p className="text-muted text-xs">Procurando…</p>
          )}
        </div>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Quantidade de cotas que você tem
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="0"
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
          {type && assetType(type).fractionDigits > 0 && (
            <span className="text-muted text-xs font-normal">Aceita fração, como 0,5 ou 1,8634.</span>
          )}
        </label>

        {type && isFixedIncomeType(type) ? (
          <p className="text-muted text-xs">
            Fundos com código (DEBB11…). Tesouro e CDB ficam em {UNQUOTED_LABEL}.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground text-sm font-medium">É um ETF (nota direta)</span>
            <Switch checked={isEtf} onChange={setIsEtf} label="É um ETF" />
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !type || !normalized || duplicate}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Adicionando…' : 'Adicionar e dar a nota'}
        </button>
      </form>
    </BottomSheet>
  );
}
