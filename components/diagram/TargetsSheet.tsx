'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  ASSET_TYPES,
  assetType,
  targetsComplete,
  targetsTotal,
  TARGET_PROFILES,
  typesInUse,
  type AssetType,
  type DiagramOverview,
  type DiagramTargets,
} from '@/lib/diagram';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { PercentInput } from '@/components/ui/PercentInput';
import { Donut } from './Donut';
import { pct } from './format';

/** Rounds to 0.1 percentage point, so 33.3 + 33.3 + 33.4 reads as 100. */
const tidy = (ratio: number) => Math.round(ratio * 1000) / 1000;

/**
 * The types of the portfolio and the target of each: ready profiles to start from, a slider per
 * type, a donut and the total as it changes. It only saves at exactly 100% (or with no type at
 * all). A type can be removed — it vanishes from the aporte and the filters, its assets wait — and
 * added again later.
 */
export function TargetsSheet({
  overview,
  onClose,
  onSave,
}: {
  overview: DiagramOverview;
  onClose: () => void;
  onSave: (targets: DiagramTargets) => Promise<void>;
}) {
  const confirm = useConfirm();
  const saved = overview.settings.targets;
  const [targets, setTargets] = useState<DiagramTargets>(saved);
  const [saving, setSaving] = useState(false);

  const inUse = typesInUse(targets);
  const absent = ASSET_TYPES.filter((type) => targets[type.key] === undefined);
  const total = targetsTotal(targets);
  const ready = inUse.length === 0 ? Object.keys(saved).length > 0 : targetsComplete(targets);
  const missing = tidy(1 - total);

  function setTarget(type: AssetType, value: number) {
    setTargets((current) => ({ ...current, [type]: tidy(value) }));
  }

  async function removeType(type: AssetType) {
    const assets = overview.assets.filter((asset) => asset.type === type).length;
    const fixed = overview.fixedIncome.find((total) => total.type === type)?.amount ?? 0;
    if (assets > 0 || fixed > 0) {
      const ok = await confirm({
        title: `Tirar ${assetType(type).label} da carteira?`,
        message:
          assets > 0
            ? `${assets === 1 ? 'O ativo fica guardado' : `Os ${assets} ativos ficam guardados`}, com as notas, para quando o tipo voltar.`
            : 'O valor desse tipo fica guardado para quando o tipo voltar.',
        confirmLabel: 'Tirar da carteira',
      });
      if (!ok) return;
    }
    setTargets((current) => {
      const next = { ...current };
      delete next[type];
      return next;
    });
  }

  return (
    <BottomSheet open title="Tipos e metas" onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready) return;
          setSaving(true);
          try {
            await onSave(targets);
          } finally {
            setSaving(false);
          }
        }}
      >
        <section className="flex flex-col gap-2">
          <h3 className="text-muted text-sm font-semibold">Comece por um perfil</h3>
          <div className="grid grid-cols-3 gap-2">
            {TARGET_PROFILES.map((profile) => (
              <button
                key={profile.key}
                type="button"
                onClick={() => setTargets(profile.targets)}
                className="border-border bg-background hover:border-primary/50 flex flex-col gap-2 rounded-xl border p-3 text-left"
              >
                <span className="text-foreground text-sm font-semibold">{profile.label}</span>
                <span className="flex h-1.5 overflow-hidden rounded-full">
                  {ASSET_TYPES.filter((type) => (profile.targets[type.key] ?? 0) > 0).map((type) => (
                    <span
                      key={type.key}
                      style={{ width: `${(profile.targets[type.key] ?? 0) * 100}%`, background: type.color }}
                    />
                  ))}
                </span>
                <span className="text-muted text-[11px] leading-snug">{profile.description}</span>
              </button>
            ))}
          </div>
          <p className="text-muted text-xs">O perfil só preenche as metas: depois ajuste do seu jeito.</p>
        </section>

        <section className="flex items-center gap-4">
          <Donut
            label="Metas por tipo"
            slices={inUse.map((type) => ({
              key: type,
              value: targets[type] ?? 0,
              color: assetType(type).color,
            }))}
            size={112}
          >
            <span
              className={`text-lg font-semibold tabular-nums ${ready || inUse.length === 0 ? 'text-foreground' : 'text-danger'}`}
            >
              {pct(total)}
            </span>
            <span className="text-muted text-[11px]">do total</span>
          </Donut>
          <p className="text-muted min-w-0 flex-1 text-sm" aria-live="polite">
            {inUse.length === 0
              ? 'Escolha um perfil ou adicione os seus tipos.'
              : targetsComplete(targets)
                ? 'As metas somam 100%. Pode salvar.'
                : missing > 0
                  ? `Faltam ${pct(missing)} para chegar a 100%.`
                  : `Passou ${pct(-missing)} de 100%. Diminua algum tipo.`}
          </p>
        </section>

        {inUse.length > 0 && (
          <ul className="flex flex-col gap-3">
            {inUse.map((key) => {
              const type = assetType(key);
              const value = targets[key] ?? 0;
              return (
                <li key={key} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: type.color }}
                    />
                    <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                      {type.label}
                    </span>
                    <PercentInput
                      value={value}
                      onChange={(next) => setTarget(key, next)}
                      ariaLabel={`Meta de ${type.label}`}
                    />
                    <button
                      type="button"
                      onClick={() => void removeType(key)}
                      aria-label={`Tirar ${type.label} da carteira`}
                      title="Tirar da carteira"
                      className="text-muted hover:text-danger flex h-10 w-9 shrink-0 items-center justify-center rounded-full"
                    >
                      <X aria-hidden className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(value * 100)}
                    onChange={(event) => setTarget(key, Number(event.target.value) / 100)}
                    aria-label={`Meta de ${type.label} (controle deslizante)`}
                    className="w-full"
                    style={{ accentColor: type.color }}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {absent.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-muted text-sm font-semibold">Adicionar tipo</h3>
            <div className="flex flex-wrap gap-2">
              {absent.map((type) => (
                <button
                  key={type.key}
                  type="button"
                  onClick={() => setTargets((current) => ({ ...current, [type.key]: 0 }))}
                  className="border-border text-foreground hover:border-primary/50 flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm"
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" style={{ color: type.color }} />
                  {type.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setTargets(saved)}
            className="border-border text-foreground min-h-[44px] flex-1 rounded-lg border px-4 text-sm font-medium"
          >
            Resetar valores
          </button>
          <button
            type="submit"
            disabled={saving || !ready}
            className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
