'use client';

import { useState } from 'react';
import {
  BUDGET_EXPLANATIONS,
  REIMBURSABLE_EXPLANATION,
  UNCOUNTED_EXPLANATION,
  activeTopics,
  formatPct,
  hasDefaultTargets,
  normalizeTopic,
  resolveSpecialCategoryColors,
  resolveSpecialCategoryLabels,
  resolveTopicColor,
  validateTopicPercentages,
  withDefaultTargets,
  type BudgetSettings,
  type ResolvedSpecialCategoryLabels,
  type SpecialCategoryColors,
  type TopicConfig,
} from '@/lib/budget';
import { resolveModules } from '@/lib/modules';
import { useSettings } from '@/components/providers/SettingsProvider';
import { PercentInput } from '@/components/ui/PercentInput';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { useToast } from '@/components/ui/Toast';

const SPECIAL_CATEGORY_FIELDS: {
  key: keyof ResolvedSpecialCategoryLabels;
  label: string;
  explanation: string;
}[] = [
  { key: 'fixedCost', label: 'Custo fixo', explanation: BUDGET_EXPLANATIONS.fixedCost },
  { key: 'unforeseen', label: 'Imprevistos', explanation: BUDGET_EXPLANATIONS.unforeseen },
];

/**
 * The four categories expenses are filed under, plus the special ones. The four are always the
 * same (lib/budget/topics.ts): nothing here creates, archives, renames or reorders them — only
 * the colour and, with `withTargets` (the Categorias screen), the target percentage, which have
 * to add up to 100% to save. "Voltar às % padrão" puts back the % and colours they come with.
 */
export function CategoriesSettings({ withTargets, onSaved }: { withTargets: boolean; onSaved?: () => void }) {
  const { settings, saveSettings } = useSettings();
  if (!settings) return null;
  return (
    <CategoriesForm
      settings={settings}
      saveSettings={saveSettings}
      withTargets={withTargets}
      onSaved={onSaved}
    />
  );
}

function CategoriesForm({
  settings,
  saveSettings,
  withTargets,
  onSaved,
}: {
  settings: BudgetSettings;
  saveSettings: (settings: BudgetSettings) => Promise<void>;
  withTargets: boolean;
  onSaved?: () => void;
}) {
  const confirm = useConfirm();
  const { showToast } = useToast();
  // A draft, seeded once: nothing changes until "Salvar".
  const [topics, setTopics] = useState<TopicConfig[]>(() => activeTopics(settings.topics).map(normalizeTopic));
  const [special, setSpecial] = useState<ResolvedSpecialCategoryLabels>(() =>
    resolveSpecialCategoryLabels(settings),
  );
  const [specialColors, setSpecialColors] = useState<SpecialCategoryColors>(() =>
    resolveSpecialCategoryColors(settings),
  );
  /** "Voltar" tapped with nothing to change; said here, since a toast sits behind the sheet. */
  const [alreadyDefault, setAlreadyDefault] = useState(false);
  /** A failed save, shown in the sheet (a toast would sit behind it). */
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const modules = resolveModules(settings);
  const validation = validateTopicPercentages(topics);
  const canSave = !withTargets || validation.valid;
  // The "A receber" label and colour only make sense while its module is on; "Fora do orçamento"
  // is not a module, so it is always here to be renamed.
  const specialFields = [
    ...SPECIAL_CATEGORY_FIELDS,
    ...(modules.reimbursable
      ? [{ key: 'reimbursable' as const, label: 'A receber', explanation: REIMBURSABLE_EXPLANATION }]
      : []),
    { key: 'uncounted' as const, label: 'Fora do orçamento', explanation: UNCOUNTED_EXPLANATION },
  ];

  function updateTopic(id: string, patch: Pick<Partial<TopicConfig>, 'color' | 'targetPct'>) {
    setTopics((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await saveSettings({
        ...settings,
        topics,
        specialCategories: special,
        specialCategoryColors: specialColors,
      });
      showToast('Categorias salvas.');
      onSaved?.();
    } catch {
      setError('Não foi possível salvar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (hasDefaultTargets(settings.topics)) {
      setAlreadyDefault(true);
      return;
    }
    const confirmed = await confirm({
      title: 'Voltar às % padrão',
      message: 'As quatro voltam às % e cores de quando você começou. Meses anteriores não mudam.',
      confirmLabel: 'Voltar',
      cancelLabel: 'Cancelar',
    });
    if (!confirmed) return;
    const previous = settings.topics;
    setBusy(true);
    setError(null);
    try {
      await saveSettings({ ...settings, topics: withDefaultTargets(settings.topics) });
      showToast('As % voltaram ao padrão.', 'success', {
        action: {
          label: 'Desfazer',
          onClick: () =>
            void saveSettings({ ...settings, topics: previous }).catch(() =>
              showToast('Não foi possível desfazer. Tente de novo.', 'error'),
            ),
        },
      });
      onSaved?.();
    } catch {
      setError('Não foi possível voltar ao padrão. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    // An editor with its own "Salvar": leaving with changes asks first (BottomSheet).
    <div className="flex flex-col gap-6" data-edit-scope>
      <section className="flex flex-col gap-3 px-4">
        <h2 className="text-muted text-sm font-semibold">
          {withTargets ? 'Categorias e metas' : 'Categorias'}
        </h2>
        <p className="text-muted text-xs">As 4 metas para os gastos da vida. Você ajusta a % e a cor.</p>
        {!withTargets && modules.budget && (
          <p className="text-muted text-xs">As metas em % de cada categoria ficam na tela Categorias.</p>
        )}
        <div className="border-border bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm">
          {topics.map((topic, index) => (
            <div key={topic.id} className="border-border flex flex-col gap-1 rounded-lg border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="color"
                  value={resolveTopicColor(topic, index)}
                  onChange={(e) => updateTopic(topic.id, { color: e.target.value })}
                  aria-label={`Cor de ${topic.name}`}
                  className="border-border h-10 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
                />
                <span className="text-foreground min-w-0 flex-1 font-semibold">{topic.name}</span>
                {withTargets && (
                  <div className="flex shrink-0 items-center gap-1">
                    <PercentInput
                      value={topic.targetPct}
                      onChange={(pct) => updateTopic(topic.id, { targetPct: pct })}
                      ariaLabel={`Percentual de ${topic.name}`}
                    />
                    <span className="text-muted">%</span>
                  </div>
                )}
              </div>
              {topic.description && <p className="text-muted text-xs">{topic.description}</p>}
            </div>
          ))}

          {withTargets && (
            <p className={`text-sm ${validation.valid ? 'text-success' : 'text-danger'}`}>
              {validation.valid
                ? 'Soma das categorias: 100%.'
                : validation.diffPct > 0
                  ? `Faltam ${formatPct(validation.diffPct)} para completar 100%.`
                  : `Excesso de ${formatPct(-validation.diffPct)} além de 100%.`}
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 px-4">
        <h2 className="text-muted text-sm font-semibold">Categorias especiais</h2>
        <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
          {specialFields.map(({ key, label, explanation }) => (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex min-w-0 items-end gap-2">
                <input
                  type="color"
                  value={specialColors[key]}
                  onChange={(e) => setSpecialColors((c) => ({ ...c, [key]: e.target.value }))}
                  aria-label={`Cor de ${label}`}
                  className="border-border h-11 w-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
                />
                <label className="text-muted flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  {label}
                  <input
                    type="text"
                    value={special[key]}
                    onChange={(e) => setSpecial((s) => ({ ...s, [key]: e.target.value }))}
                    className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-full min-w-0 rounded-md border px-3 outline-none focus:ring-2"
                  />
                </label>
              </div>
              <p className="text-muted text-xs">{explanation}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2 px-4">
        {error && (
          <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave || busy}
          data-edit-save
          className="bg-primary text-primary-foreground min-h-[44px] w-full rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {busy ? 'Salvando…' : 'Salvar categorias'}
        </button>
      </section>

      {withTargets && (
        <section className="border-border flex flex-col gap-2 border-t px-4 pt-5">
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={busy}
            className="border-border text-foreground min-h-[44px] w-full rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
          >
            Voltar às % padrão
          </button>
          {alreadyDefault && (
            <p className="text-success text-xs" role="status">
              Suas categorias já estão com as % padrão.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
