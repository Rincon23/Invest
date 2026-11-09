/** Rounds a number to 2 decimal places, guarding against float drift (e.g. 0.1 + 0.2). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Sums a list of numbers, rounded to 2 decimal places. */
export function sum(values: number[]): number {
  return round2(values.reduce((total, value) => total + value, 0));
}

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Formats a number as Brazilian currency, e.g. `R$ 1.234,56`. */
export function formatBRL(value: number): string {
  return BRL_FORMATTER.format(round2(value));
}

/** Formats a 0..1 ratio as a Brazilian-locale percentage, e.g. `37,5%`. */
export function formatPct(ratio: number, fractionDigits = 1): string {
  return `${(ratio * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

/** Parses a Brazilian-formatted amount string ("1.234,56" or "1234.56") typed by the user. */
export function parseAmountInput(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;

  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  const value = Number.parseFloat(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(value) ? value : 0;
}

/** The most digits an amount field takes: R$ 999.999.999,99. */
const MAX_AMOUNT_DIGITS = 11;

/**
 * What an amount field shows while the person types, the way a bank app does it: the digits fill
 * in from the cents, so nobody has to type the comma. "1" is "0,01", "1234" is "12,34", and the
 * thousands get their dots ("123456" is "1.234,56"). Anything that is not a digit is ignored;
 * no digits at all is an empty field.
 */
export function formatAmountTyping(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_AMOUNT_DIGITS);
  if (digits === '') return '';
  const padded = digits.padStart(3, '0');
  const integer = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${integer},${padded.slice(-2)}`;
}

/** Formats a number for editing inside an amount input, e.g. 144.8 -> "144,80". */
export function amountToInputValue(value: number): string {
  return round2(value).toFixed(2).replace('.', ',');
}
