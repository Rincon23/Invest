'use client';

import { useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import {
  TAG_LIMITS,
  TAG_NOTICE,
  TAG_SUGGESTIONS,
  TAG_VS_CATEGORY,
  TAG_VS_CATEGORY_DETAIL,
  createTag,
  nextTagColor,
  tagColor,
  tagNameProblem,
  tagsOfKind,
  type TagKind,
} from '@/lib/budget';
import { saveTag } from '@/lib/storage';
import { useOptionalSettings } from '@/components/providers/SettingsProvider';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { InfoTip } from '@/components/ui/InfoTip';
import { TagColorChoice } from './TagColorChoice';
import { TagDot } from './TagPills';
import { TagsSettings } from './TagsSettings';

/**
 * The "Tags" field of the expense and income forms (and of the templates and instalment plans):
 * chips to mark one or more, and "+ Nova tag" to create one right there, with its name and colour.
 * Optional, and placed after the fields that matter, so a quick entry never has to look at it. The
 * first time, one line says how a tag differs from a category.
 */
export function TagPicker({
  kind,
  value,
  onChange,
}: {
  kind: TagKind;
  value: string[];
  onChange: (tagIds: string[]) => void;
}) {
  const context = useOptionalSettings();
  const settings = context?.settings ?? null;
  const tags = tagsOfKind(settings?.tags, kind);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  /** The colour picked for the new tag; null is the next free one of the palette. */
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const newColor = color ?? nextTagColor(settings?.tags, kind);

  const full = value.length >= TAG_LIMITS.perEntry;
  const showNotice = Boolean(settings) && !settings?.dismissedNotices?.includes(TAG_NOTICE);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  function dismissNotice() {
    if (!context || !settings || settings.dismissedNotices?.includes(TAG_NOTICE)) return;
    void context
      .saveSettings({ ...settings, dismissedNotices: [...(settings.dismissedNotices ?? []), TAG_NOTICE] })
      .catch(() => undefined);
  }

  /** Creates the tag (with the colour picked, when there is one) and marks it on this entry. */
  async function create(raw: string, pickedColor?: string) {
    if (!context || !settings) return;
    const problem = tagNameProblem(raw, kind, settings.tags, settings.topics);
    if (problem) {
      setError(problem);
      return;
    }
    const tag = createTag(raw, kind, settings.tags, pickedColor);
    setBusy(true);
    setError(null);
    try {
      context.setTags(await saveTag(tag));
      if (!full) onChange([...value, tag.id]);
      setName('');
      setColor(null);
      setCreating(false);
      dismissNotice();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a tag. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted flex items-center gap-1.5 text-sm font-medium">
          <TagIcon aria-hidden className="h-4 w-4" />
          Tags
          <span className="text-muted/80 text-xs font-normal">(opcional)</span>
        </span>
        {tags.length > 0 && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-muted hover:text-foreground min-h-[32px] px-1 text-xs font-medium underline underline-offset-2"
          >
            Editar tags
          </button>
        )}
      </div>

      {showNotice && (
        <div className="bg-primary/10 flex items-start gap-2 rounded-lg px-3 py-2 text-xs">
          <InfoTip info={TAG_VS_CATEGORY_DETAIL} label="Tag ou categoria?">
            <span className="text-foreground">{TAG_VS_CATEGORY}</span>
          </InfoTip>
          <button type="button" onClick={dismissNotice} className="text-primary shrink-0 font-semibold">
            Entendi
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const selected = value.includes(tag.id);
          const dot = tagColor(tag);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(tag.id)}
              disabled={!selected && full}
              className={`text-foreground flex min-h-[36px] max-w-full items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors disabled:opacity-40 ${
                selected ? '' : 'border-border bg-background border-dashed'
              }`}
              style={
                selected
                  ? { borderColor: dot, background: `color-mix(in srgb, ${dot} 16%, transparent)` }
                  : undefined
              }
            >
              <TagDot tag={tag} />
              <span className="truncate">{tag.name}</span>
            </button>
          );
        })}
        {tags.length === 0 &&
          !creating &&
          TAG_SUGGESTIONS[kind].map((suggestion) => (
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
        {!creating && (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
            disabled={busy}
            className="text-primary min-h-[36px] rounded-full px-2 text-sm font-semibold disabled:opacity-50"
          >
            + Nova tag
          </button>
        )}
      </div>

      {creating && (
        // Typing a tag's name or picking its colour is not a change to the entry (see unsavedChanges.ts).
        <div className="flex flex-col gap-2" data-dirty-ignore>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Enter creates the tag; it must not submit the form around it.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void create(name, newColor);
                }
              }}
              maxLength={TAG_LIMITS.name}
              placeholder="Nome da tag"
              aria-label="Nome da nova tag"
              autoFocus
              className="border-border bg-background text-foreground focus:ring-primary min-h-[40px] min-w-0 flex-1 rounded-lg border px-3 text-base outline-none focus:ring-2"
            />
            <button
              type="button"
              onClick={() => void create(name, newColor)}
              disabled={busy}
              className="bg-primary text-primary-foreground min-h-[40px] shrink-0 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
            >
              Criar
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setName('');
                setColor(null);
                setError(null);
              }}
              className="text-muted min-h-[40px] shrink-0 px-1 text-sm"
            >
              Cancelar
            </button>
          </div>
          <TagColorChoice value={newColor} onChange={setColor} label="Cor da nova tag" />
        </div>
      )}

      {full && <p className="text-muted text-xs">Até {TAG_LIMITS.perEntry} tags por lançamento.</p>}
      {error && (
        <p className="text-danger text-xs" role="alert">
          {error}
        </p>
      )}

      {editing && (
        // The sheet sits inside the entry's form: what is typed in it is not a change to the entry.
        <div data-dirty-ignore>
          <BottomSheet open title="Editar tags" onClose={() => setEditing(false)} confirmDiscard={false}>
            <div className="-mx-4">
              <TagsSettings kinds={[kind]} />
            </div>
          </BottomSheet>
        </div>
      )}
    </div>
  );
}
