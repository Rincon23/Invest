'use client';

import { assetType, type AssetType } from '@/lib/diagram';

/**
 * The coloured chips that pick a type — the filters of the asset list and the type of the
 * questions. With `all`, a first chip "Todos" stands for no filter (`selected` null).
 */
export function TypeChips<T extends AssetType>({
  types,
  selected,
  onSelect,
  all,
  tourAnchor,
}: {
  types: T[];
  selected: T | null;
  onSelect: (type: T) => void;
  all?: { label: string; onSelect: () => void };
  tourAnchor?: string;
}) {
  const chip = 'flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium';
  return (
    <div
      className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1"
      data-no-swipe-nav
      data-tour={tourAnchor}
    >
      {all && (
        <button
          type="button"
          aria-pressed={selected === null}
          onClick={all.onSelect}
          className={`${chip} ${selected === null ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted'}`}
        >
          {all.label}
        </button>
      )}
      {types.map((key) => {
        const type = assetType(key);
        const on = selected === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(key)}
            className={`${chip} ${on ? 'text-foreground' : 'border-border text-muted'}`}
            style={on ? { borderColor: type.color, background: `color-mix(in srgb, ${type.color} 16%, transparent)` } : undefined}
          >
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: type.color }} />
            {type.label}
          </button>
        );
      })}
    </div>
  );
}
