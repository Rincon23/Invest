/** A quote older than this is shown with a warning ("desatualizada"). */
export const PRICE_STALE_MINUTES = 60;

/** Whether a price fetched at `fetchedAt` is too old to trust without a warning. */
export function isPriceStale(
  fetchedAt: string | null | undefined,
  now: Date = new Date(),
  maxAgeMinutes = PRICE_STALE_MINUTES,
): boolean {
  if (!fetchedAt) return true;
  const age = now.getTime() - new Date(fetchedAt).getTime();
  return !Number.isFinite(age) || age > maxAgeMinutes * 60_000;
}
