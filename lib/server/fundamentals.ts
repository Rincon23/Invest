import 'server-only';

/**
 * LPA, VPA and P/VP of B3 stocks and real-estate funds, for the Diagrama's automatic questions
 * (Graham, P/VP). Free and without any token: Fundamentus's public page of each asset, the same
 * numbers the owner's spreadsheet pulled. Not an API with guarantees, so the app reads the
 * numbers from `fundamentals_cache` and never needs a live answer to render a screen.
 */

export interface FetchedFundamentals {
  ticker: string;
  lpa: number | null;
  /** VPA for a stock, VP/Cota for a fund. */
  vpa: number | null;
  pvp: number | null;
}

const FUNDAMENTUS_URL = 'https://www.fundamentus.com.br/detalhes.php';
const TIMEOUT_MS = 8_000;
/** Parallel pages: polite, and plenty for a personal portfolio. */
const CONCURRENCY = 3;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; Capital/1.0)', Accept: 'text/html' };

/** "1,49", "-0,52", "1.234,56" → numbers; "-" and "" → null. */
export function parseBrazilianNumber(text: string): number | null {
  const clean = text.trim().replace(/%$/, '');
  if (!/\d/.test(clean)) return null;
  const value = Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** The value next to a label of the page ("LPA", "VPA", "P/VP", "VP/Cota"). */
function field(html: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const match = new RegExp(
    `<span class="txt">${escaped}</span>\\s*</td>\\s*<td[^>]*>\\s*<span class="txt">([^<]*)</span>`,
  ).exec(html);
  return match ? parseBrazilianNumber(match[1]) : null;
}

/** Reads an asset's page. Null when Fundamentus does not know the ticker. */
export function parseFundamentus(ticker: string, html: string): FetchedFundamentals | null {
  if (/Nenhum papel encontrado/i.test(html)) return null;
  const lpa = field(html, 'LPA');
  const vpa = field(html, 'VPA') ?? field(html, 'VP/Cota');
  const pvp = field(html, 'P/VP');
  if (lpa === null && vpa === null && pvp === null) return null;
  return { ticker, lpa, vpa, pvp };
}

async function getPage(ticker: string): Promise<string | null> {
  try {
    const response = await fetch(`${FUNDAMENTUS_URL}?papel=${encodeURIComponent(ticker)}`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    // The page is ISO-8859-1.
    return new TextDecoder('latin1').decode(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** The indicators of these B3 tickers. Unknown ones are left out — never an exception. */
export async function fetchFundamentals(tickers: string[]): Promise<Map<string, FetchedFundamentals>> {
  const wanted = [...new Set(tickers)];
  const found = new Map<string, FetchedFundamentals>();
  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    const batch = wanted.slice(i, i + CONCURRENCY);
    const pages = await Promise.all(batch.map(async (ticker) => [ticker, await getPage(ticker)] as const));
    for (const [ticker, html] of pages) {
      const parsed = html ? parseFundamentus(ticker, html) : null;
      if (parsed) found.set(ticker, parsed);
    }
  }
  return found;
}
