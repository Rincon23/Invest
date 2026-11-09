import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import type { PriceQuote } from '../core/types';
import { priceCache } from './db/schema';
import type { Database } from './db/types';
import { fetchQuotes, normalizeTicker } from './quotes';

/**
 * The one quote service of the Orange Pi: the Invest + answers it for itself (the Diagrama) and for
 * the Capital +, which asks it the price of its Reserva investida instead of going to B3 and Yahoo on
 * its own. A price fetched by either app serves both, so a ticker is never fetched twice in the
 * same few minutes.
 *
 * It is reached only inside the Docker network (`http://invest:3000/api/internal/quotes`), with the
 * secret both apps share (QUOTES_SERVICE_TOKEN). A request that came through the Cloudflare tunnel
 * (it always carries `cf-connecting-ip`) is refused whatever it says.
 */

/** A cached price younger than this is answered as it is. */
export const QUOTE_SERVICE_FRESH_MS = 15 * 60_000;

/** Whether the request may use the service: the shared secret, and never from the internet. */
export function quoteServiceAllowed(headers: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.QUOTES_SERVICE_TOKEN?.trim();
  if (!secret || secret.length < 16) return false;
  if (headers.get('cf-connecting-ip') !== null) return false;
  const sent = headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const a = Buffer.from(sent);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The prices of these B3 tickers: what the cache has from the last 15 minutes, and a fresh fetch
 * (B3, then Yahoo) for the rest, kept in the cache for the next asker. A ticker neither source knows
 * comes back in `missing`; when the sources fail, the last cached price is answered anyway.
 */
export async function quotesFor(
  db: Database,
  tickers: string[],
  now: Date = new Date(),
): Promise<{ quotes: PriceQuote[]; missing: string[] }> {
  const wanted = [...new Set(tickers.map(normalizeTicker).filter(Boolean))];
  if (wanted.length === 0) return { quotes: [], missing: [] };

  const rows = await db.select().from(priceCache).where(inArray(priceCache.ticker, wanted));
  const cached = new Map(rows.map((row) => [row.ticker, row]));
  const stale = wanted.filter((ticker) => {
    const row = cached.get(ticker);
    return !row || now.getTime() - row.fetchedAt.getTime() > QUOTE_SERVICE_FRESH_MS;
  });

  if (stale.length > 0) {
    const fetched = await fetchQuotes(stale).catch(() => new Map<string, never>());
    for (const quote of fetched.values()) {
      const values = { price: quote.price, name: quote.name ?? null, source: quote.source, fetchedAt: now };
      await db
        .insert(priceCache)
        .values({ ticker: quote.ticker, ...values })
        .onConflictDoUpdate({ target: priceCache.ticker, set: values });
      cached.set(quote.ticker, { ticker: quote.ticker, ...values });
    }
  }

  const quotes: PriceQuote[] = [];
  const missing: string[] = [];
  for (const ticker of wanted) {
    const row = cached.get(ticker);
    if (!row) {
      missing.push(ticker);
      continue;
    }
    quotes.push({
      ticker,
      price: row.price,
      fetchedAt: row.fetchedAt.toISOString(),
      ...(row.name ? { name: row.name } : {}),
      ...(row.source === 'b3' || row.source === 'yahoo' ? { source: row.source } : {}),
    });
  }
  return { quotes, missing };
}
