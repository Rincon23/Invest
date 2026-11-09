'use client';

import { TAG_COLORS } from '@/lib/budget';

const COLOR_NAMES: Record<string, string> = {
  '#2a78d6': 'Azul',
  '#1baf7a': 'Verde',
  '#eda100': 'Amarelo',
  '#e87ba4': 'Rosa',
  '#eb6834': 'Laranja',
  '#4a3aa7': 'Roxo',
  '#008300': 'Verde-escuro',
  '#e34948': 'Vermelho',
  '#0d9488': 'Turquesa',
  '#6b7280': 'Cinza',
};

/**
 * The colour of a tag: the palette's circles and, last, "Outra cor" (the phone's colour picker).
 * Used when a tag is created and when its colour is changed.
 */
export function TagColorChoice({
  value,
  onChange,
  label = 'Cor da tag',
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  const current = value.toLowerCase();
  const custom = !TAG_COLORS.some((color) => color.toLowerCase() === current);
  const ring = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2';
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {TAG_COLORS.map((color) => {
        const on = color.toLowerCase() === current;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={COLOR_NAMES[color] ?? color}
            onClick={() => onChange(color)}
            className={ring}
            style={{ borderColor: on ? color : 'transparent' }}
          >
            <span aria-hidden className="h-7 w-7 rounded-full" style={{ background: color }} />
          </button>
        );
      })}
      <label
        className={`${ring} relative cursor-pointer`}
        style={{ borderColor: custom ? value : 'transparent' }}
        title="Outra cor"
      >
        <span
          aria-hidden
          className="h-7 w-7 rounded-full"
          style={{
            background: custom
              ? value
              : 'conic-gradient(#e34948, #eda100, #1baf7a, #0d9488, #2a78d6, #4a3aa7, #e87ba4, #e34948)',
          }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Outra cor"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
