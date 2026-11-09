'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  TAG_COLORS,
  TAG_LIMITS,
  TAG_SUGGESTIONS,
  TAG_VS_CATEGORY,
  TAG_VS_CATEGORY_DETAIL,
  createTag,
  nextTagColor,
  tagColor,
  tagNameProblem,
  tagsOfKind,
  type Tag,
  type TagKind,
} from '@/lib/budget';
import { deleteTag, restoreTag, saveTag, tagUsage } from '@/lib/storage';
import { useOptionalSettings } from '@/components/providers/SettingsProvider';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/Toast';
import { TagColorChoice } from './TagColorChoice';
import { TagDot } from './TagPills';

const KIND_TITLE: Record<TagKind, string> = { expense: 'Tags de gasto', income: 'Tags de renda' };

/** How long a colour waits before it is saved, so dragging the picker does not save every step. */
const COLOR_SAVE_MS = 500;

/**
 * Creating (name and colour), renaming, recolouring and deleting tags (the gear of Lançamentos,
 * and "Editar tags" in the forms). Every change is saved right away, on its own, so nothing here is a draft: there
 * is no "Salvar" and no "leave without saving?" question. Deleting takes the tag off every entry,
 * with "Desfazer"; the numbers never change.
 */
export function TagsSettings({ kinds = ['expense', 'income'] }: { kinds?: TagKind[] }) {
  return (
    <section className="flex flex-col gap-3 px-4">
      <h2 className="text-muted text-sm font-semibold">Tags</h2>
      <div className="text-muted text-xs">
        <InfoTip info={TAG_VS_CATEGORY_DETAIL} label="Tag ou categoria?">
          <span>{TAG_VS_CATEGORY}</span>
        </InfoTip>
      </div>
      {kinds.map((kind) => (
        <TagList key={kind} kind={kind} title={kinds.length > 1 ? KIND_TITLE[kind] : undefined} />
      ))}
    </section>
  );
}

function TagList({ kind, title }: { kind: TagKind; title?: string }) {
  const context = useOptionalSettings();
  const settings = context?.settings ?? null;
  const confirm = useConfirm();
  const { showToast } = useToast();
  const tags = tagsOfKind(settings?.tags, kind);
  const [name, setName] = useState('');
  /** The colour picked for the new tag; null is the next free one of the palette. */
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const newColor = color ?? nextTagColor(settings?.tags, kind);

  async function run(action: () => Promise<Tag[]>): Promise<boolean> {
    if (!context) return false;
    setBusy(true);
    setError(null);
    try {
      context.setTags(await action());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar. Tente de novo.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(raw: string, pickedColor?: string) {
    if (!settings) return;
    const problem = tagNameProblem(raw, kind, settings.tags, settings.topics);
    if (problem) {
      setError(problem);
      return;
    }
    if (await run(() => saveTag(createTag(raw, kind, settings.tags, pickedColor)))) {
      setName('');
      setColor(null);
    }
  }

  async function remove(tag: Tag) {
    if (!context) return;
    const count = await tagUsage()
      .then((usage) => usage[tag.id] ?? 0)
      .catch(() => null);
    const where =
      count === null
        ? 'Ela sai dos lançamentos que a têm.'
        : count === 0
          ? 'Nenhum lançamento tem essa tag.'
          : `Ela sai de ${count} ${count === 1 ? 'lançamento' : 'lançamentos'}.`;
    const confirmed = await confirm({
      title: `Apagar a tag ${tag.name}?`,
      message: `${where} Os valores não mudam.`,
      confirmLabel: 'Apagar',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const { tags: left, refs } = await deleteTag(tag.id);
      context.setTags(left);
      showToast(`Tag ${tag.name} apagada.`, 'success', {
        action: {
          label: 'Desfazer',
          onClick: () =>
            void restoreTag(tag, refs)
              .then(context.setTags)
              .catch(() => showToast('Não foi possível desfazer. Tente de novo.', 'error')),
        },
      });
    } catch {
      setError('Não foi possível apagar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {title && <h3 className="text-foreground text-sm font-semibold">{title}</h3>}
      <div className="border-border bg-card flex flex-col gap-2 rounded-xl border p-3 shadow-sm">
        {tags.length === 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted text-sm">Nenhuma ainda. Sugestões:</span>
            {TAG_SUGGESTIONS[kind].map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void create(suggestion)}
                disabled={busy}
                className="border-border text-muted hover:text-foreground min-h-[36px] rounded-full border border-dashed px-3 text-sm font-medium disabled:opacity-50"
              >
                + {suggestion}
              </button>
            ))}
          </div>
        )}

        {tags.map((tag) => (
          <TagRow
            key={tag.id}
            tag={tag}
            busy={busy}
            onRename={(next) =>
              settings
                ? (() => {
                    const problem = tagNameProblem(next, kind, settings.tags, settings.topics, tag.id);
                    if (problem) {
                      setError(problem);
                      return Promise.resolve(false);
                    }
                    return run(() => saveTag({ ...tag, name: next }));
                  })()
                : Promise.resolve(false)
            }
            onColor={(color) => void run(() => saveTag({ ...tag, color }))}
            onDelete={() => void remove(tag)}
          />
        ))}

        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create(name, newColor);
              }
            }}
            maxLength={TAG_LIMITS.name}
            placeholder={kind === 'expense' ? 'Nova tag de gasto' : 'Nova tag de renda'}
            aria-label={kind === 'expense' ? 'Nova tag de gasto' : 'Nova tag de renda'}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[40px] min-w-0 flex-1 rounded-lg border px-3 text-base outline-none focus:ring-2"
          />
          <button
            type="button"
            onClick={() => void create(name, newColor)}
            disabled={busy || !name.trim()}
            className="bg-primary text-primary-foreground min-h-[40px] shrink-0 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
          >
            Criar
          </button>
        </div>
        {name.trim() && (
          <TagColorChoice
            value={newColor}
            onChange={setColor}
            label={kind === 'expense' ? 'Cor da nova tag de gasto' : 'Cor da nova tag de renda'}
          />
        )}

        {error && (
          <p className="text-danger text-xs" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function TagRow({
  tag,
  busy,
  onRename,
  onColor,
  onDelete,
}: {
  tag: Tag;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onColor: (color: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tagColor(tag));
  const [choosingColor, setChoosingColor] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  function pickColor(next: string) {
    setColor(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onColor(next), COLOR_SAVE_MS);
  }

  async function saveName() {
    const next = name.replace(/\s+/g, ' ').trim();
    if (next === tag.name) {
      setRenaming(false);
      return;
    }
    if (await onRename(next)) setRenaming(false);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setChoosingColor((open) => !open)}
          aria-expanded={choosingColor}
          aria-label={`Cor da tag ${tag.name}`}
          className="hover:bg-border/40 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        >
          <TagDot tag={{ color, order: tag.order }} className="h-5 w-5" />
        </button>
        {renaming ? (
          <>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveName();
                }
                if (e.key === 'Escape') {
                  setName(tag.name);
                  setRenaming(false);
                }
              }}
              maxLength={TAG_LIMITS.name}
              aria-label={`Novo nome da tag ${tag.name}`}
              autoFocus
              className="border-border bg-background text-foreground focus:ring-primary min-h-[40px] min-w-0 flex-1 rounded-lg border px-3 text-base outline-none focus:ring-2"
            />
            <button
              type="button"
              onClick={() => void saveName()}
              disabled={busy}
              className="bg-primary text-primary-foreground min-h-[40px] shrink-0 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
            >
              Salvar
            </button>
          </>
        ) : (
          <>
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
            <button
              type="button"
              onClick={() => {
                setName(tag.name);
                setRenaming(true);
              }}
              disabled={busy}
              className="text-muted hover:text-foreground min-h-[40px] shrink-0 px-2 text-sm disabled:opacity-50"
            >
              Renomear
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              aria-label={`Apagar a tag ${tag.name}`}
              className="text-muted hover:text-danger flex h-10 w-10 shrink-0 items-center justify-center rounded-md disabled:opacity-50"
            >
              <Trash2 aria-hidden className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
      {choosingColor && (
        <div className="pl-1">
          <TagColorChoice
            value={color}
            onChange={(next) => {
              pickColor(next);
              // A colour of the palette is one tap; "Outra cor" stays open while the picker is dragged.
              if (TAG_COLORS.includes(next)) setChoosingColor(false);
            }}
            label={`Cor da tag ${tag.name}`}
          />
        </div>
      )}
    </div>
  );
}
