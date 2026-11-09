'use client';

/** An on/off toggle. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-primary' : 'bg-border'
      }`}
    >
      <span
        aria-hidden
        className={`bg-card absolute top-1 h-5 w-5 rounded-full shadow transition-all ${
          checked ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  );
}
