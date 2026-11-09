import { assetType, type AssetType } from '@/lib/diagram';

/** "13", "0,1400", "0,00060661": whole quotas plainly, fractions with the digits that matter. */
export function formatQuantity(quantity: number, type: AssetType): string {
  const digits = assetType(type).fractionDigits;
  if (digits === 0 || Number.isInteger(quantity)) {
    return quantity.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  return quantity.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: Math.min(digits, 8) });
}

/** "2 cotas", "1 cota", "0,14 cota". */
export function quotasLabel(quantity: number, type: AssetType): string {
  return `${formatQuantity(quantity, type)} ${quantity === 1 || (quantity > 0 && quantity < 1) ? 'cota' : 'cotas'}`;
}

/** "08/10/2026" from "2026-10-08". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** "08/10 às 19:40" from a timestamp. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${date.toLocaleTimeString(
    'pt-BR',
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

/** A percentage of 0..1 with one decimal: "12,5%". */
export function pct(ratio: number): string {
  return `${(ratio * 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}
