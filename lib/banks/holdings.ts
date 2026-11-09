import { isB3Ticker } from '../diagram/assetTypes';
import type { AssetType, DiagramAsset } from '../diagram/types';
import { zonedMoment, formatDayMonth } from '../reminders/time';
import { formatAgo } from './format';
import { connectionHealth } from './health';
import type { BankConnectionStatus } from './types';

/**
 * The broker against the Diagrama: share by share, the quantity a bank says the person holds
 * (Pluggy's `GET /investments`) next to the quantity typed in the Diagrama. Nothing is changed
 * here: the screen offers each correction and the person taps it (a purchase takes about 2
 * business days to settle at B3, so a difference is often just a trade on its way).
 *
 * Only what a Brazilian bank can report takes part: stocks, FIIs, ETFs and BDRs with a B3 code.
 * An asset held abroad or in crypto (VOO, BTC) never shows up in Open Finance, so it is never
 * called missing.
 *
 * The Reserva investida also holds a B3 ticker (AUPO11…), usually at the same broker, so its
 * quotas are counted with the Diagrama's: for that ticker "aqui" is Diagrama + Reserva. A
 * correction only ever touches the Diagrama (bank − Reserva); the Reserva has its own movements.
 */

/** One investment as the last read brought it, with the name of its bank. */
export interface BankHolding {
  investmentId: string;
  itemId: string;
  bankName: string;
  name: string;
  /** Pluggy's type and subtype: EQUITY / STOCK, EQUITY / REAL_ESTATE_FUND, FIXED_INCOME / CDB… */
  type: string | null;
  subtype: string | null;
  /** The ticker for a listed asset ("PETR4"). */
  code: string | null;
  isin: string | null;
  /** Null when the bank didn't say. */
  quantity: number | null;
  /** The person marked it as part of the Reserva ("Atualizar pelos bancos conectados"). */
  feedsReserve: boolean;
}

/** A bank that sent investments, and when its data is from. */
export interface HoldingsBank {
  itemId: string;
  name: string;
  status: BankConnectionStatus;
  lastUpdatedAt: string | null;
}

/** What the Diagrama asks the server for (GET /api/v1/banks/holdings). */
export interface BankHoldings {
  banks: HoldingsBank[];
  holdings: BankHolding[];
  /** The Reserva investida, when that module is on and holds quotas. */
  reserve: { ticker: string; quotas: number } | null;
}

/** Below this difference (a ten-thousandth of a share) two quantities are the same. */
export const QUANTITY_TOLERANCE = 0.0001;

const LISTED_SUBTYPES = new Set(['STOCK', 'REAL_ESTATE_FUND', 'ETF', 'BDR']);
const LISTED_TYPES = new Set(['EQUITY', 'ETF']);
/** Listed, but not something anyone keeps in the Diagrama. */
const NOT_HELD_SUBTYPES = new Set(['DERIVATIVES', 'OPTION', 'OPTIONS', 'FUTURES', 'WARRANT']);

/**
 * A code as the Diagrama keeps a B3 ticker: upper case, no spaces, no ".SA", and no "F" of the
 * fractional market ("PETR4F" is PETR4). Null when it isn't a B3 ticker.
 */
export function holdingTicker(code: string | null | undefined): string | null {
  if (!code) return null;
  let ticker = code.trim().toUpperCase().replace(/\s+/g, '').replace(/\.SA$/, '');
  const fractional = /^([A-Z0-9]{4}\d{1,2})F$/.exec(ticker);
  if (fractional) ticker = fractional[1];
  return isB3Ticker(ticker) ? ticker : null;
}

/** The ticker of an investment the Diagrama could hold (null for fixed income, funds, options…). */
export function listedTicker(
  holding: Pick<BankHolding, 'type' | 'subtype' | 'code' | 'name'>,
): string | null {
  const subtype = holding.subtype?.toUpperCase() ?? null;
  const type = holding.type?.toUpperCase() ?? null;
  if (subtype && NOT_HELD_SUBTYPES.has(subtype)) return null;
  if (!(subtype && LISTED_SUBTYPES.has(subtype)) && !(type && LISTED_TYPES.has(type))) return null;
  // Some banks leave the code empty and put the bare ticker as the name.
  return holdingTicker(holding.code) ?? holdingTicker(holding.name);
}

/**
 * A subscription right or a receipt (B3 codes ending in 1, 2, 9, 10, 12, 13, 14 or 15, like
 * HGRU12): it lasts a few days until it becomes the asset itself, so it is never offered to add.
 */
export function isTemporaryRight(ticker: string): boolean {
  return /^[A-Z0-9]{4}(1|2|9|10|12|13|14|15)$/.test(ticker);
}

/**
 * The Diagrama type an investment most likely goes in; null when the person must say: an ETF, or
 * a code ending in 11 that the bank calls a stock (a unit like TAEE11, but banks file ETFs and
 * FIIs there too).
 */
export function suggestedAssetType(subtype: string | null, ticker = ''): AssetType | null {
  switch (subtype?.toUpperCase()) {
    case 'STOCK':
      return ticker.endsWith('11') ? null : 'brStocks';
    case 'REAL_ESTATE_FUND':
      return 'fiis';
    case 'BDR':
      return 'intlStocks';
    default:
      return null;
  }
}

/** One Diagrama asset against the banks. */
export interface AssetCheck {
  /**
   * - `match`: the banks hold what the Capital has;
   * - `different`: both have it, in different quantities;
   * - `onlyCapital`: the Capital has it and no connected bank sent it.
   */
  status: 'match' | 'different' | 'onlyCapital';
  ticker: string;
  /** What the banks hold, summed (0 when none sent it). */
  bank: number;
  /** The banks that sent it; for `onlyCapital`, every bank that sent investments. */
  banks: string[];
  /** The Diagrama (every asset of this ticker) plus the Reserva investida's quotas of it. */
  capital: number;
  /** The Reserva investida's part of `capital` (0 unless it is the Reserva's ticker). */
  reserve: number;
  /**
   * What "Usar" saves as this asset's quantity so the Capital matches the banks (bank − Reserva).
   * Null when no single change in the Diagrama does it: the ticker is in two of its types, or
   * the asset already has that quantity (the Reserva alone holds more than the banks).
   */
  use: number | null;
  /**
   * When it doesn't match: other classes of the same company the banks hold and the Diagrama
   * doesn't ("KLBN4: 157" next to a KLBN3 the bank has none of), a likely typo before "Usar 0".
   */
  related: { ticker: string; bank: number }[];
}

/** In a bank and not in the Diagrama ("Adicionar"). */
export interface BankOnlyHolding {
  ticker: string;
  /** What the banks hold beyond the Reserva investida: the quantity "Adicionar" fills in. */
  quantity: number;
  bank: number;
  reserve: number;
  banks: string[];
  /** The bank's name for it ("PETROBRAS PN"). */
  name: string;
  subtype: string | null;
  /** Where "Adicionar" starts; null when the person picks (an ETF can be any type). */
  type: AssetType | null;
  isEtf: boolean;
}

export interface HoldingsCheck {
  /** By Diagrama asset id; an asset the banks can't speak about (VOO, BTC) has none. */
  assets: Record<string, AssetCheck>;
  onlyBank: BankOnlyHolding[];
  /**
   * The Reserva investida holds more of its ticker than the banks, and the Diagrama has none of
   * it: nothing to fix here, but worth a look in the Reserva.
   */
  reserveAbove: { ticker: string; reserve: number; bank: number; banks: string[] } | null;
  /** The banks that sent stocks or funds (none: there is nothing to compare). */
  banks: string[];
}

const round8 = (value: number) => Math.round(value * 1e8) / 1e8;
const same = (a: number, b: number) => Math.abs(a - b) <= QUANTITY_TOLERANCE;

interface Position {
  quantity: number;
  /** Some investment of this ticker came without a quantity: it can't be compared. */
  unknown: boolean;
  banks: string[];
  /** Every investment of it is marked as part of the Reserva. */
  allReserve: boolean;
  name: string;
  subtype: string | null;
}

/**
 * Compares the banks with the Diagrama. Pure: the screen recomputes it after every change of a
 * quantity, without asking the banks again.
 */
export function checkHoldings(
  data: Pick<BankHoldings, 'holdings' | 'reserve'>,
  assets: Pick<DiagramAsset, 'id' | 'ticker' | 'quantity'>[],
): HoldingsCheck {
  const positions = new Map<string, Position>();
  for (const holding of data.holdings) {
    const ticker = listedTicker(holding);
    if (!ticker) continue;
    const position = positions.get(ticker) ?? {
      quantity: 0,
      unknown: false,
      banks: [],
      allReserve: true,
      name: holding.name,
      subtype: holding.subtype,
    };
    if (holding.quantity === null) position.unknown = true;
    else position.quantity = round8(position.quantity + holding.quantity);
    if (!position.banks.includes(holding.bankName)) position.banks.push(holding.bankName);
    position.allReserve &&= holding.feedsReserve;
    positions.set(ticker, position);
  }
  // Only a bank that told some quantity can be compared with (one read before the quantities
  // were kept has none of them yet).
  const banks = [
    ...new Set(
      data.holdings
        .filter((holding) => holding.quantity !== null && listedTicker(holding) !== null)
        .map((holding) => holding.bankName),
    ),
  ];
  const result: HoldingsCheck = { assets: {}, onlyBank: [], reserveAbove: null, banks };
  if (banks.length === 0) return result;

  const byTicker = new Map<string, Pick<DiagramAsset, 'id' | 'ticker' | 'quantity'>[]>();
  for (const asset of assets) {
    if (!isB3Ticker(asset.ticker)) continue;
    byTicker.set(asset.ticker, [...(byTicker.get(asset.ticker) ?? []), asset]);
  }
  const reserveQuotas = Math.max(0, data.reserve?.quotas ?? 0);
  const reserveTicker = reserveQuotas > 0 ? holdingTicker(data.reserve?.ticker) : null;

  const tickers = new Set([
    ...byTicker.keys(),
    ...positions.keys(),
    ...(reserveTicker ? [reserveTicker] : []),
  ]);
  for (const ticker of [...tickers].sort()) {
    const position = positions.get(ticker);
    if (position?.unknown) continue;
    const bank = position?.quantity ?? 0;
    const reserve = ticker === reserveTicker ? reserveQuotas : 0;
    const held = byTicker.get(ticker) ?? [];

    if (held.length > 0) {
      const capital = round8(held.reduce((sum, asset) => sum + asset.quantity, 0) + reserve);
      const inBank = bank > QUANTITY_TOLERANCE;
      if (!inBank && capital <= QUANTITY_TOLERANCE) continue;
      const status = same(bank, capital) ? 'match' : inBank ? 'different' : 'onlyCapital';
      const target = round8(Math.max(0, bank - reserve));
      const related =
        status === 'match'
          ? []
          : [...positions.entries()]
              .filter(
                ([other, sibling]) =>
                  other !== ticker &&
                  other.slice(0, 4) === ticker.slice(0, 4) &&
                  !sibling.unknown &&
                  sibling.quantity > QUANTITY_TOLERANCE &&
                  !byTicker.has(other) &&
                  !isTemporaryRight(other),
              )
              .map(([other, sibling]) => ({ ticker: other, bank: sibling.quantity }))
              .sort((a, b) => a.ticker.localeCompare(b.ticker));
      for (const asset of held) {
        result.assets[asset.id] = {
          status,
          ticker,
          bank,
          banks: position?.banks ?? banks,
          capital,
          reserve,
          use: status !== 'match' && held.length === 1 && !same(asset.quantity, target) ? target : null,
          related,
        };
      }
      continue;
    }

    if (position && bank - reserve > QUANTITY_TOLERANCE) {
      // Marked as the Reserva in the bank's list: the person already said where it belongs.
      if (position.allReserve || isTemporaryRight(ticker)) continue;
      const subtype = position.subtype?.toUpperCase() ?? null;
      result.onlyBank.push({
        ticker,
        quantity: round8(bank - reserve),
        bank,
        reserve,
        banks: position.banks,
        name: position.name,
        subtype,
        type: suggestedAssetType(subtype, ticker),
        isEtf: subtype === 'ETF',
      });
    } else if (reserve - bank > QUANTITY_TOLERANCE) {
      result.reserveAbove = { ticker, reserve, bank, banks: position?.banks ?? banks };
    }
  }
  return result;
}

/** "BTG Pactual", "BTG Pactual e XP", "BTG Pactual, Nubank e XP". */
export function bankNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * The line that says when the banks' data is from ("BTG Pactual · atualizado há 5 h"), or, when
 * one of them stopped sending, that its quantities are the last ones that came. Only the banks
 * that sent stocks or funds count. (No "do"/"da": a bank's name has no known gender.)
 */
export function holdingsStatusLine(
  banks: HoldingsBank[],
  names: string[],
  now: number,
): { text: string; warning: boolean } | null {
  const sent = banks.filter((bank) => names.includes(bank.name));
  if (sent.length === 0) return null;
  const stopped = sent.find((bank) => connectionHealth(bank, now) !== 'ok');
  if (stopped) {
    const when = stopped.lastUpdatedAt
      ? formatDayMonth(zonedMoment(new Date(stopped.lastUpdatedAt)).date)
      : null;
    return {
      text: `${stopped.name}: sem dados novos; as quantidades são as últimas que chegaram${when ? `, de ${when}` : ''}.`,
      warning: true,
    };
  }
  const oldest = sent
    .map((bank) => bank.lastUpdatedAt)
    .filter((date): date is string => date !== null)
    .sort()[0];
  return {
    text: `${bankNames(sent.map((bank) => bank.name))}${oldest ? ` · atualizado ${formatAgo(oldest, now)}` : ''}`,
    warning: false,
  };
}
