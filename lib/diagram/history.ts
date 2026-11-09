import { isFixedIncomeType, typesInUse } from './assetTypes';
import { fixedIncomeAmount } from './portfolio';
import type { AssetType, DiagramAsset, DiagramOverview, FixedIncomeType } from './types';

/**
 * The Histórico's Investimentos tab: how the portfolio went up and down. It is the portfolio of
 * today (the quotas the person holds now) at the prices of each past day — no purchase price, no
 * aportes, no sales: only what the market did to what the person has.
 */

export type HistoryRange = '1m' | '6m' | '1a' | '5a';

export interface HistoryRangeDefinition {
  key: HistoryRange;
  /** On the chips: "6M". */
  label: string;
  /** Under the hero: "em 6 meses". */
  phrase: string;
  /** Yahoo's range and interval (lib/server/quotes.ts). */
  yahooRange: string;
  interval: '1d' | '1wk';
}

export const HISTORY_RANGES: HistoryRangeDefinition[] = [
  { key: '1m', label: '1M', phrase: 'em 1 mês', yahooRange: '1mo', interval: '1d' },
  { key: '6m', label: '6M', phrase: 'em 6 meses', yahooRange: '6mo', interval: '1d' },
  { key: '1a', label: '1A', phrase: 'em 1 ano', yahooRange: '1y', interval: '1d' },
  { key: '5a', label: '5A', phrase: 'em 5 anos', yahooRange: '5y', interval: '1wk' },
];

export const HISTORY_RANGE_KEYS = HISTORY_RANGES.map((range) => range.key);

export function historyRange(key: HistoryRange): HistoryRangeDefinition {
  const found = HISTORY_RANGES.find((range) => range.key === key);
  if (!found) throw new Error(`Período desconhecido: ${key}`);
  return found;
}

/** A closing price on a day: ["2026-10-17", 38.42]. */
export type PricePoint = [date: string, close: number];

/** What the server sends: the closing price in R$ of every asset, on the same dates. */
export interface PriceHistory {
  range: HistoryRange;
  /** "2026-04-20", oldest first. */
  dates: string[];
  /** By asset id, one price per date in R$; null before the asset had a price (listed later). */
  prices: Record<string, (number | null)[]>;
}

/** How far one close must be from both neighbours to be a mistake of the source. */
const SPIKE = 0.5;
/** How close the neighbours must be to each other for that (the price did not really move). */
const CALM = 0.15;

function far(a: number, b: number, limit: number): boolean {
  return Math.abs(a / b - 1) > limit;
}

/**
 * Drops the closes the free source got wrong: a single day (or week) far from both its neighbours
 * while they agree with each other — XPML11 at R$ 1,06 for a week between two R$ 110. A real
 * crash does not come back the next close, so it stays.
 */
export function dropSpikes(points: PricePoint[]): PricePoint[] {
  return points.filter(([, close], index) => {
    const before = points[index - 1]?.[1];
    const after = points[index + 1]?.[1];
    if (before !== undefined && after !== undefined) {
      return !(far(close, before, SPIKE) && far(close, after, SPIKE) && !far(before, after, CALM));
    }
    // The first close has only what comes after it, so only a gross mistake (5×) is dropped there.
    const next = points[index + 2]?.[1];
    if (before === undefined && after !== undefined && next !== undefined) {
      return !(Math.abs(Math.log(close / after)) > Math.log(5) && !far(after, next, CALM));
    }
    return true;
  });
}

/** Six significant digits: plenty for a chart, and a light answer even for a long list. */
function trim(value: number): number {
  return Number(value.toPrecision(6));
}

/** The price on each of `dates`: the last close up to that day; null before the first one. */
function onDates(dates: string[], points: PricePoint[]): (number | null)[] {
  const sorted = [...points].sort((a, b) => a[0].localeCompare(b[0]));
  const out: (number | null)[] = [];
  let index = 0;
  let last: number | null = null;
  for (const date of dates) {
    while (index < sorted.length && sorted[index][0] <= date) {
      last = sorted[index][1];
      index += 1;
    }
    out.push(last);
  }
  return out;
}

/**
 * Puts every asset on the same dates (the days any of them traded), carrying each price forward
 * over the days its market was closed, and turns the US$ prices into R$ with the dollar of each
 * day. The closes the source got wrong are dropped first (`dropSpikes`); an asset without a
 * series, or in US$ with no dollar, is left out.
 */
export function alignHistory(
  range: HistoryRange,
  assets: { id: string; points: PricePoint[] | undefined; inDollars: boolean }[],
  dollar: PricePoint[] | undefined,
): PriceHistory {
  dollar = dollar && dropSpikes(dollar);
  const priced = assets
    .map((asset) => ({ ...asset, points: asset.points && dropSpikes(asset.points) }))
    .filter(
      (asset): asset is { id: string; points: PricePoint[]; inDollars: boolean } =>
        !!asset.points && asset.points.length > 0 && (!asset.inDollars || (!!dollar && dollar.length > 0)),
    );
  const dates = [...new Set(priced.flatMap((asset) => asset.points.map(([date]) => date)))].sort();
  const dollarOn = dollar && dollar.length > 0 ? onDates(dates, dollar) : [];
  // Before the dollar's first close (a different calendar), its first close stands in.
  const firstDollar = dollar && dollar.length > 0 ? [...dollar].sort((a, b) => a[0].localeCompare(b[0]))[0][1] : 1;

  const prices: Record<string, (number | null)[]> = {};
  for (const asset of priced) {
    prices[asset.id] = onDates(dates, asset.points).map((price, index) => {
      if (price === null) return null;
      return trim(asset.inDollars ? price * (dollarOn[index] ?? firstDollar) : price);
    });
  }
  return { range, dates, prices };
}

// ---------------------------------------------------------------------------
// What the screen shows
// ---------------------------------------------------------------------------

type Source = Pick<DiagramOverview, 'settings' | 'assets' | 'fixedIncome' | 'quotes'>;

/**
 * - `value`: the portfolio in R$ (the quotas of today × the price of each day, plus the fixed
 *   income without a quote, which stays still).
 * - `index`: no asset has a quantity yet (only notes), so each asset counts the same and only the
 *   % means something.
 */
export type HistoryMode = 'value' | 'index';

export interface HistoryPoint {
  date: string;
  /** R$ in `value` mode; in `index` mode, 1 is where the period started. */
  value: number;
}

export interface HistorySeries {
  mode: HistoryMode;
  points: HistoryPoint[];
  start: number;
  end: number;
  /** In R$ (0 in `index` mode). */
  change: number;
  /** end / start − 1; null when it started at zero. */
  changePct: number | null;
}

/** The assets of the portfolio that the history priced, in the types in use (and in `type`). */
function assetsInScope(source: Source, history: PriceHistory, type: AssetType | null): DiagramAsset[] {
  const inUse = new Set(typesInUse(source.settings.targets));
  return source.assets.filter(
    (asset) => inUse.has(asset.type) && (type === null || asset.type === type) && !!history.prices[asset.id],
  );
}

function fixedTypesInScope(source: Source, type: AssetType | null): FixedIncomeType[] {
  return typesInUse(source.settings.targets).filter(
    (key): key is FixedIncomeType => isFixedIncomeType(key) && (type === null || key === type),
  );
}

/**
 * An asset's price on each date, with no gaps: before it had a price it stands at its first one
 * (so a fund listed in the middle of the period doesn't make the portfolio jump), and on the last
 * date it is the price the Diagrama shows today, so both screens show the same total.
 */
export function filledPrices(asset: DiagramAsset, source: Pick<Source, 'quotes'>, history: PriceHistory): number[] {
  const raw = history.prices[asset.id] ?? [];
  const first = raw.find((price): price is number => price !== null);
  if (first === undefined) return [];
  const filled = raw.map((price) => price ?? first);
  const today = source.quotes[asset.id]?.price;
  if (today && filled.length > 0) filled[filled.length - 1] = today;
  return filled;
}

function summarize(mode: HistoryMode, points: HistoryPoint[]): HistorySeries {
  const start = points[0]?.value ?? 0;
  const end = points.at(-1)?.value ?? 0;
  return {
    mode,
    points,
    start,
    end,
    change: mode === 'value' ? end - start : 0,
    changePct: start > 0 ? end / start - 1 : null,
  };
}

/** The portfolio (or one type of it) on every date of the history. */
export function portfolioHistory(source: Source, history: PriceHistory, type: AssetType | null = null): HistorySeries {
  const assets = assetsInScope(source, history, type);
  const fixed = fixedTypesInScope(source, type).reduce((total, key) => total + fixedIncomeAmount(source, key), 0);
  const held = assets.filter((asset) => asset.quantity > 0);

  if (held.length > 0 || (assets.length === 0 && fixed > 0)) {
    const series = held.map((asset) => ({ quantity: asset.quantity, prices: filledPrices(asset, source, history) }));
    const points = history.dates.map((date, index) => ({
      date,
      value: fixed + series.reduce((total, item) => total + item.quantity * (item.prices[index] ?? 0), 0),
    }));
    return summarize('value', points);
  }

  // Only notes, no quantities: the average of the assets, each one counting the same.
  const series = assets.map((asset) => filledPrices(asset, source, history)).filter((prices) => prices.length > 0);
  if (series.length === 0) return summarize('index', []);
  const points = history.dates.map((date, index) => ({
    date,
    value: series.reduce((total, prices) => total + prices[index] / prices[0], 0) / series.length,
  }));
  return summarize('index', points);
}

/** Days from one "2026-04-19" to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/**
 * An asset that got its first price this long after the period began was listed later. Less is
 * just another calendar: a Sunday priced only for crypto, a holiday, a week filed on its Monday.
 */
const LISTED_LATER_DAYS = 10;

export interface AssetHistory {
  asset: DiagramAsset;
  /** The prices of the period, for the small line. */
  prices: number[];
  /** Price change in the period (last / first − 1). */
  changePct: number;
  /** What it did to the person's position, in R$ (0 without a quantity). */
  change: number;
  /** When it only got a price after the period began (listed later): that first date. */
  since: string | null;
}

/** Each asset in scope with how its price went in the period, the best first. */
export function assetsHistory(source: Source, history: PriceHistory, type: AssetType | null = null): AssetHistory[] {
  return assetsInScope(source, history, type)
    .map((asset) => {
      const prices = filledPrices(asset, source, history);
      const raw = history.prices[asset.id] ?? [];
      const firstIndex = Math.max(0, raw.findIndex((price) => price !== null));
      const first = prices[0] ?? 0;
      const last = prices.at(-1) ?? 0;
      const listedLater =
        firstIndex > 0 && daysBetween(history.dates[0], history.dates[firstIndex]) > LISTED_LATER_DAYS;
      return {
        asset,
        prices: prices.slice(firstIndex),
        changePct: first > 0 ? last / first - 1 : 0,
        change: asset.quantity > 0 ? asset.quantity * (last - first) : 0,
        since: listedLater ? history.dates[firstIndex] : null,
      };
    })
    .sort((a, b) => b.changePct - a.changePct);
}

export interface TypeHistory {
  type: AssetType;
  series: HistorySeries;
  /** False when all of it is fixed income without a quote: it has no ups and downs to show. */
  quoted: boolean;
}

/** Every type in use that has something to show, in screen order. */
export function typesHistory(source: Source, history: PriceHistory): TypeHistory[] {
  return typesInUse(source.settings.targets)
    .map((type) => ({
      type,
      series: portfolioHistory(source, history, type),
      quoted: assetsInScope(source, history, type).length > 0,
    }))
    .filter(({ series }) => series.points.length > 0 && series.end > 0);
}
