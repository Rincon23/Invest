import { round2 } from './money';
import type { InvestmentBucket, InvestmentReserve, PriceQuote, PriceSource } from './types';

/**
 * The invested reserve: a position in one ticker (AUPO11 in my case), split into buckets (shown as "categorias" in the app — never "baldes").
 * Each bucket holds quotas earmarked for a topic; whatever is not in a bucket is the free
 * reserve, which is the part that counts as emergency money in the cash report.
 */

/** A quote older than this is shown with a warning ("desatualizada"). */
export const PRICE_STALE_MINUTES = 60;

export function quotaValue(quotas: number, price: number): number {
  return round2(quotas * price);
}

/** Quotas of the reserve that are not earmarked by any bucket. Can go negative if over-allocated. */
export function freeReserveQuotas(
  reserve: Pick<InvestmentReserve, 'totalQuotas'>,
  buckets: Pick<InvestmentBucket, 'quotas'>[],
): number {
  const allocated = buckets.reduce((total, bucket) => total + bucket.quotas, 0);
  return reserve.totalQuotas - allocated;
}

/** How many quotas `amount` buys at `price`. Fractional, like the spreadsheet. */
export function quotasForAmount(amount: number, price: number): number {
  if (!(price > 0)) return 0;
  return amount / price;
}

export interface InvestmentBucketSummary extends InvestmentBucket {
  value: number;
}

export interface InvestmentSummary {
  ticker: string;
  totalQuotas: number;
  price: number | null;
  /** When the price was fetched, or null when there has never been a quote. */
  fetchedAt: string | null;
  /** Which free source the price came from, when known. */
  source: PriceSource | null;
  /** The asset's name as the source gave it, when known. */
  assetName: string | null;
  stale: boolean;
  freeQuotas: number;
  /** Value of the free reserve — the only part that counts in the cash report. */
  freeValue: number;
  /** Value of every quota held, buckets included. */
  totalValue: number;
  buckets: InvestmentBucketSummary[];
}

export function isPriceStale(
  fetchedAt: string | null | undefined,
  now: Date = new Date(),
  maxAgeMinutes = PRICE_STALE_MINUTES,
): boolean {
  if (!fetchedAt) return true;
  const age = now.getTime() - new Date(fetchedAt).getTime();
  return !Number.isFinite(age) || age > maxAgeMinutes * 60_000;
}

export function summarizeInvestments(
  reserve: InvestmentReserve,
  buckets: InvestmentBucket[],
  quote: PriceQuote | null,
  now: Date = new Date(),
): InvestmentSummary {
  const price = quote?.price ?? null;
  const freeQuotas = freeReserveQuotas(reserve, buckets);

  return {
    ticker: reserve.ticker,
    totalQuotas: reserve.totalQuotas,
    price,
    fetchedAt: quote?.fetchedAt ?? null,
    source: quote?.source ?? null,
    assetName: quote?.name ?? null,
    stale: isPriceStale(quote?.fetchedAt, now),
    freeQuotas,
    freeValue: price === null ? 0 : quotaValue(freeQuotas, price),
    totalValue: price === null ? 0 : quotaValue(reserve.totalQuotas, price),
    buckets: buckets.map((bucket) => ({
      ...bucket,
      value: price === null ? 0 : quotaValue(bucket.quotas, price),
    })),
  };
}
