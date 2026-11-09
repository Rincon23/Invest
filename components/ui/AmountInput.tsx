'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { amountToInputValue, formatAmountTyping, parseAmountInput } from '@/lib/budget';

/** Whatever the field was given ("144,8", "100", "1.234,56"), shown the way it is typed: "144,80". */
function display(value: string): string {
  return value.trim() === '' ? '' : formatAmountTyping(amountToInputValue(parseAmountInput(value)));
}

/**
 * The amount of a form, typed like in a bank app: only digits, filling in from the cents, so the
 * comma (and the thousands dots) appear on their own and the cursor stays at the end.
 */
export function AmountInput({
  value,
  onChange,
  autoFocus,
  label = 'Valor em reais',
  trailing,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** Names the field when the sheet has more than one amount (e.g. "Valor total da compra"). */
  label?: string;
  /** Something small at the end of the row, e.g. the card toggle of the expense form. */
  trailing?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const shown = display(value);

  // The dots and the comma move as the digits come in; the cursor always goes back to the end.
  useLayoutEffect(() => {
    const element = input.current;
    if (element && document.activeElement === element) {
      element.setSelectionRange(shown.length, shown.length);
    }
  }, [shown]);

  function toEnd() {
    const element = input.current;
    if (element) element.setSelectionRange(element.value.length, element.value.length);
  }

  return (
    <div className="border-border bg-background focus-within:ring-primary flex items-center gap-2 rounded-xl border px-4 py-3 focus-within:ring-2">
      <span className="text-muted text-xl font-semibold">R$</span>
      <input
        ref={input}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="0,00"
        value={shown}
        onChange={(event) => onChange(formatAmountTyping(event.target.value))}
        onFocus={toEnd}
        onClick={toEnd}
        className="text-foreground w-full min-w-0 bg-transparent text-3xl font-semibold tabular-nums outline-none"
        aria-label={label}
      />
      {trailing}
    </div>
  );
}
