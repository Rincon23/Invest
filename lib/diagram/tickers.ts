import type { QuoteMarket } from './types';

/**
 * The code of an asset as the app keeps it: upper case, without the exchange prefix the person
 * may paste from a quote site ("BATS:WTAI" → "WTAI"), without ".SA" on a B3 code and without the
 * currency on a crypto pair ("btc-brl" → "BTC").
 */
export function normalizeAssetTicker(market: QuoteMarket, raw: string): string {
  let ticker = raw.trim().toUpperCase().replace(/\s+/g, '');
  const colon = ticker.lastIndexOf(':');
  if (colon >= 0) ticker = ticker.slice(colon + 1);
  // A B3 code pasted with Yahoo's suffix, in any type (IVVB11.SA in Ações internacionais).
  ticker = ticker.replace(/\.SA$/, '');
  if (market === 'crypto') ticker = ticker.replace(/-(BRL|USD|USDT)$/, '');
  return ticker;
}

/** A ticker the app accepts: letters, digits, dots and dashes (BRK-B, BF.B), up to 15. */
export function isValidAssetTicker(ticker: string): boolean {
  return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker);
}

/**
 * The key of a price in the shared price cache. B3 codes keep the plain key the Reserva investida
 * already uses ("AUPO11"); the other markets get a prefix so "O" (a REIT) never meets a B3 code.
 */
export function priceCacheKey(market: QuoteMarket | 'fx', ticker: string): string {
  if (market === 'b3') return ticker;
  if (market === 'us') return `US:${ticker}`;
  if (market === 'crypto') return `CRYPTO:${ticker}`;
  return `FX:${ticker}`;
}

/** R$ per US$, in the price cache. */
export const DOLLAR_CACHE_KEY = priceCacheKey('fx', 'USDBRL');

/** Whether a name or a source's kind says the asset is an ETF ("Vanguard S&P 500 ETF", AUVP11's "FDI"). */
export function looksLikeEtf(name: string | undefined, kind?: string): boolean {
  if (kind && kind.toUpperCase() === 'ETF') return true;
  if (!name) return false;
  // A B3 ETF is listed as a plain stock; its name says "Fundo de Índice".
  return /\b(ETF|FDI|INDEX FUND)\b/i.test(name) || /fundo de [íi]ndice/i.test(name);
}
