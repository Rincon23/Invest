'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, Plus } from 'lucide-react';
import {
  REIMBURSABLE_EXPLANATION,
  UNCOUNTED_ADVICE,
  UNCOUNTED_EXPLANATION,
  quickCategoryKey,
  resolveSpecialCategoryLabels,
  type CategoryKind,
  type QuickCategoryKey,
  type SpecialCategoryLabels,
  type TopicConfig,
} from '@/lib/budget';
import { Chip } from './Chip';
import { InfoTip } from './InfoTip';

export interface CategoryValue {
  categoryKind: CategoryKind;
  topicId?: string;
}

interface CategoryOption {
  key: QuickCategoryKey;
  label: string;
  /** What choosing it sets (a special kind keeps the topic it had, as the form always did). */
  pick: (current: CategoryValue) => CategoryValue;
  badge?: string;
  badgeTone?: 'warning' | 'success';
  tourAnchor?: string;
}

/**
 * The category of an expense: one chip per active category, plus the special categories.
 * Shared by the expense form and by the Carteira forms (recurring templates, instalment plans),
 * so a category means the same thing and looks the same everywhere.
 *
 * With `quick`, only those chips show straight away and the rest wait behind "Outras" — the
 * expense form is filled many times a day, and a row of every category made it look crowded.
 * "Editar" lets the person choose which ones stay in front.
 */
export function CategoryPicker({
  topics,
  specialCategories,
  value,
  onChange,
  showReimbursable = false,
  showUncounted = true,
  recommended,
  quick,
  onQuickChange,
}: {
  topics: TopicConfig[];
  specialCategories: SpecialCategoryLabels;
  value: CategoryValue;
  onChange: (value: CategoryValue) => void;
  showReimbursable?: boolean;
  /**
   * Whether to offer "Fora do orçamento" — the escape hatch for a gasto that should consume no
   * category. It is offered wherever an expense is filed, and always marked "Não recomendado".
   */
  showUncounted?: boolean;
  /**
   * A categoria que este formulário recomenda, marcada com "Recomendado". Só faz sentido onde
   * existe uma resposta certa — recompor a reserva é imprevisto —, nunca no gasto do dia a dia.
   */
  recommended?: CategoryKind;
  /** The categories shown straight away; absent shows every one of them. */
  quick?: QuickCategoryKey[];
  /** Saves a new choice of `quick` ("Editar"); without it the choice cannot be changed here. */
  onQuickChange?: (next: QuickCategoryKey[]) => Promise<void>;
}) {
  const activeTopics = useMemo(
    () => topics.filter((t) => !t.archived).sort((a, b) => a.order - b.order),
    [topics],
  );
  const labels = resolveSpecialCategoryLabels(specialCategories);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<QuickCategoryKey[] | null>(null);
  const [saving, setSaving] = useState(false);

  const recommendedBadge = (kind: CategoryKind) =>
    recommended === kind ? { badge: 'Recomendado', badgeTone: 'success' as const } : {};
  const options: CategoryOption[] = [
    ...activeTopics.map((topic) => ({
      key: `topic:${topic.id}` as const,
      label: topic.name,
      pick: () => ({ categoryKind: 'topic' as const, topicId: topic.id }),
      ...recommendedBadge('topic'),
    })),
    {
      key: 'fixedCost',
      label: labels.fixedCost,
      pick: (current) => ({ categoryKind: 'fixedCost', topicId: current.topicId }),
      ...recommendedBadge('fixedCost'),
    },
    {
      key: 'unforeseen',
      label: labels.unforeseen,
      pick: (current) => ({ categoryKind: 'unforeseen', topicId: current.topicId }),
      ...recommendedBadge('unforeseen'),
    },
    ...(showReimbursable
      ? [
          {
            key: 'reimbursable' as const,
            label: labels.reimbursable,
            pick: (current: CategoryValue) => ({
              categoryKind: 'reimbursable' as const,
              topicId: current.topicId,
            }),
            tourAnchor: 'categoria-a-receber',
          },
        ]
      : []),
    ...(showUncounted
      ? [
          {
            key: 'uncounted' as const,
            label: labels.uncounted,
            pick: (current: CategoryValue) => ({
              categoryKind: 'uncounted' as const,
              topicId: current.topicId,
            }),
            badge: 'Não recomendado',
            tourAnchor: 'categoria-fora-do-orcamento',
          },
        ]
      : []),
  ];

  const selectedKey = quickCategoryKey(value);
  // The chosen category always shows, even when it is one of the "Outras".
  const front = quick ? options.filter((o) => quick.includes(o.key) || o.key === selectedKey) : options;
  const others = quick ? options.filter((o) => !front.includes(o)) : [];

  const chip = (option: CategoryOption) => (
    <Chip
      key={option.key}
      label={option.label}
      badge={option.badge}
      badgeTone={option.badgeTone}
      tourAnchor={option.tourAnchor}
      selected={option.key === selectedKey}
      onClick={() => onChange(option.pick(value))}
    />
  );

  async function finishEditing() {
    if (!editing || !onQuickChange) return;
    setSaving(true);
    try {
      // Kept in the order the categories are listed, whatever order they were tapped in.
      await onQuickChange(options.map((o) => o.key).filter((key) => editing.includes(key)));
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* What "Salvar as alterações?" watches (unsavedChanges.ts): the category chosen — not the
          chips themselves, which come and go with "Outras" and "Editar". */}
      <input type="hidden" name="categoria" value={selectedKey} />
      <div data-dirty-ignore>
        <div className="mb-2 flex min-h-[28px] items-center justify-between gap-2">
          <p className="text-muted text-sm font-medium">Categoria</p>
          {quick && onQuickChange && !editing && (
            <button
              type="button"
              onClick={() => setEditing(options.map((o) => o.key).filter((key) => quick.includes(key)))}
              className="text-primary flex min-h-[32px] items-center gap-1 rounded-full px-2 text-xs font-semibold"
            >
              <Pencil aria-hidden className="h-3.5 w-3.5" />
              Editar
            </button>
          )}
        </div>

        {editing ? (
          <div className="bg-background border-border flex flex-col gap-3 rounded-xl border p-3">
            <p className="text-muted text-xs">Escolha as que aparecem direto; as outras ficam em “Outras”.</p>
            <div className="flex flex-wrap gap-2">
              {options.map((option) => {
                const on = editing.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setEditing(
                        (current) =>
                          current &&
                          (on ? current.filter((key) => key !== option.key) : [...current, option.key]),
                      )
                    }
                    className={`flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted border-dashed'
                    }`}
                  >
                    {on ? (
                      <Check aria-hidden className="h-4 w-4" />
                    ) : (
                      <Plus aria-hidden className="h-4 w-4" />
                    )}
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={saving}
                className="border-border text-foreground min-h-[40px] flex-1 rounded-lg border px-3 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void finishEditing()}
                disabled={saving}
                className="bg-primary text-primary-foreground min-h-[40px] flex-1 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
              >
                {saving ? 'Salvando…' : 'Pronto'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {front.map(chip)}
              {others.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((current) => !current)}
                  aria-expanded={expanded}
                  className="border-border text-muted hover:text-foreground flex min-h-[44px] items-center gap-1 rounded-full border border-dashed px-4 text-sm font-medium"
                >
                  {expanded ? 'Menos' : 'Outras'}
                  {expanded ? (
                    <ChevronUp aria-hidden className="h-4 w-4" />
                  ) : (
                    <ChevronDown aria-hidden className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
            {expanded && others.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">{others.map(chip)}</div>
            )}
          </>
        )}
      </div>

      {value.categoryKind === 'reimbursable' && (
        <div className="mt-2">
          <InfoTip info={REIMBURSABLE_EXPLANATION} label="Como funciona o A receber?">
            <span className="text-muted text-xs">Não gasta nenhuma categoria.</span>
          </InfoTip>
        </div>
      )}
      {value.categoryKind === 'uncounted' && (
        <div className="bg-warning-bg mt-2 rounded-lg px-3 py-2">
          <InfoTip
            info={
              <>
                {UNCOUNTED_EXPLANATION} {UNCOUNTED_ADVICE}
              </>
            }
            label="Por que não é recomendado?"
          >
            <span className="text-warning text-xs font-semibold">
              Não recomendado: nenhuma categoria mostra.
            </span>
          </InfoTip>
        </div>
      )}
    </div>
  );
}
