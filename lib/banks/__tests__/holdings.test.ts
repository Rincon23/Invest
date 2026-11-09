import { describe, expect, it } from 'vitest';
import {
  bankNames,
  checkHoldings,
  holdingsStatusLine,
  holdingTicker,
  isTemporaryRight,
  listedTicker,
  suggestedAssetType,
  type BankHolding,
} from '..';

let next = 0;
const holding = (
  code: string | null,
  quantity: number | null,
  overrides: Partial<BankHolding> = {},
): BankHolding => ({
  investmentId: `inv-${++next}`,
  itemId: 'item-btg',
  bankName: 'BTG Pactual',
  name: code ?? 'Investimento',
  type: 'EQUITY',
  subtype: 'STOCK',
  code,
  isin: null,
  quantity,
  feedsReserve: false,
  ...overrides,
});
const asset = (id: string, ticker: string, quantity: number) => ({ id, ticker, quantity });

describe('the ticker of a bank investment', () => {
  it('reads it as the Diagrama keeps it, the fractional market included', () => {
    expect(holdingTicker(' petr4 ')).toBe('PETR4');
    expect(holdingTicker('PETR4F')).toBe('PETR4');
    expect(holdingTicker('HGLG11.SA')).toBe('HGLG11');
    expect(holdingTicker('AAPL34')).toBe('AAPL34');
    expect(holdingTicker('CDB-BTG-2027')).toBeNull();
    expect(holdingTicker(null)).toBeNull();
  });

  it('takes only stocks, FIIs, ETFs and BDRs — never fixed income, funds or options', () => {
    expect(listedTicker({ type: 'EQUITY', subtype: 'STOCK', code: 'WEGE3', name: 'WEG ON' })).toBe('WEGE3');
    expect(listedTicker({ type: 'EQUITY', subtype: 'REAL_ESTATE_FUND', code: 'HGLG11', name: '' })).toBe(
      'HGLG11',
    );
    expect(listedTicker({ type: 'ETF', subtype: null, code: 'IVVB11', name: '' })).toBe('IVVB11');
    expect(listedTicker({ type: 'EQUITY', subtype: 'BDR', code: 'AAPL34', name: '' })).toBe('AAPL34');
    expect(listedTicker({ type: 'FIXED_INCOME', subtype: 'CDB', code: 'CDB12', name: '' })).toBeNull();
    expect(
      listedTicker({ type: 'MUTUAL_FUND', subtype: 'INVESTMENT_FUND', code: 'ABCD11', name: '' }),
    ).toBeNull();
    expect(listedTicker({ type: 'EQUITY', subtype: 'OPTION', code: 'PETRJ30', name: '' })).toBeNull();
    // No code: the bare ticker as the name still counts.
    expect(listedTicker({ type: 'EQUITY', subtype: 'STOCK', code: null, name: 'PETR4' })).toBe('PETR4');
  });

  it('suggests where an investment goes in the Diagrama, and lets the person pick for an ETF', () => {
    expect(suggestedAssetType('STOCK', 'WEGE3')).toBe('brStocks');
    expect(suggestedAssetType('REAL_ESTATE_FUND', 'HGLG11')).toBe('fiis');
    expect(suggestedAssetType('BDR', 'AAPL34')).toBe('intlStocks');
    expect(suggestedAssetType('ETF', 'IVVB11')).toBeNull();
    // The BTG files ETFs and some FIIs as stocks (AUVP11, PMLL11): an 11 is the person's call.
    expect(suggestedAssetType('STOCK', 'AUVP11')).toBeNull();
  });

  it('tells a subscription right or a receipt from the asset', () => {
    expect(isTemporaryRight('HGRU12')).toBe(true);
    expect(isTemporaryRight('ITSA1')).toBe(true);
    expect(isTemporaryRight('PETR9')).toBe(true);
    expect(isTemporaryRight('HGRU11')).toBe(false);
    expect(isTemporaryRight('PETR4')).toBe(false);
    expect(isTemporaryRight('AAPL34')).toBe(false);
  });
});

describe('the banks against the Diagrama', () => {
  it('says, asset by asset, whether it matches, differs or is only in the Capital', () => {
    const check = checkHoldings(
      {
        holdings: [
          holding('PETR4', 100),
          holding('WEGE3', 120),
          holding('HGLG11', 7, { subtype: 'REAL_ESTATE_FUND' }),
        ],
        reserve: null,
      },
      [asset('a', 'PETR4', 100), asset('b', 'WEGE3', 100), asset('c', 'ITSA4', 50), asset('d', 'VALE3', 0)],
    );
    expect(check.banks).toEqual(['BTG Pactual']);
    expect(check.assets.a).toMatchObject({ status: 'match', bank: 100, capital: 100, use: null });
    expect(check.assets.b).toMatchObject({ status: 'different', bank: 120, capital: 100, use: 120 });
    expect(check.assets.c).toMatchObject({
      status: 'onlyCapital',
      bank: 0,
      capital: 50,
      use: 0,
      banks: ['BTG Pactual'],
    });
    // Nothing typed and nothing in the bank: nothing to say.
    expect(check.assets.d).toBeUndefined();
    expect(check.onlyBank).toEqual([
      expect.objectContaining({ ticker: 'HGLG11', quantity: 7, type: 'fiis', isEtf: false }),
    ]);
  });

  it('points at another class of the same company the bank holds (KLBN4 for a KLBN3 at 0)', () => {
    const check = checkHoldings(
      {
        holdings: [holding('KLBN3', 0), holding('KLBN4', 157), holding('KLBN11', 2), holding('KLBN12', 1)],
        reserve: null,
      },
      [asset('a', 'KLBN3', 140), asset('b', 'KLBN11', 2)],
    );
    // KLBN11 is in the Diagrama already and KLBN12 is a right: only KLBN4 is pointed at.
    expect(check.assets.a).toMatchObject({
      status: 'onlyCapital',
      use: 0,
      related: [{ ticker: 'KLBN4', bank: 157 }],
    });
    expect(check.assets.b).toMatchObject({ status: 'match', related: [] });
  });

  it('sums the same ticker across banks and lines (the fractional market too)', () => {
    const check = checkHoldings(
      {
        holdings: [
          holding('ITSA4', 100),
          holding('ITSA4F', 7),
          holding('ITSA4', 10, { itemId: 'item-xp', bankName: 'XP' }),
        ],
        reserve: null,
      },
      [asset('a', 'ITSA4', 117)],
    );
    expect(check.assets.a).toMatchObject({ status: 'match', bank: 117, banks: ['BTG Pactual', 'XP'] });
  });

  it('tolerates the crumbs of a fraction', () => {
    const check = checkHoldings(
      { holdings: [holding('IVVB11', 10.00000003, { subtype: 'ETF' })], reserve: null },
      [asset('a', 'IVVB11', 10)],
    );
    expect(check.assets.a.status).toBe('match');
    const off = checkHoldings({ holdings: [holding('IVVB11', 10.5, { subtype: 'ETF' })], reserve: null }, [
      asset('a', 'IVVB11', 10),
    ]);
    expect(off.assets.a).toMatchObject({ status: 'different', use: 10.5 });
  });

  it('leaves alone what Open Finance never sends (abroad, crypto) and what came without a quantity', () => {
    const check = checkHoldings(
      { holdings: [holding('PETR4', 100), holding('BBAS3', null)], reserve: null },
      [asset('voo', 'VOO', 3), asset('btc', 'BTC', 0.01), asset('bb', 'BBAS3', 10)],
    );
    expect(check.assets).toEqual({});
    expect(check.onlyBank.map((item) => item.ticker)).toEqual(['PETR4']);
  });

  it('compares nothing when no bank sent stocks or funds', () => {
    const check = checkHoldings(
      { holdings: [holding('CDB1', 1, { type: 'FIXED_INCOME', subtype: 'CDB' })], reserve: null },
      [asset('a', 'PETR4', 100)],
    );
    expect(check).toEqual({ assets: {}, onlyBank: [], reserveAbove: null, banks: [] });
    // Read before the quantities were kept: nothing to compare yet either.
    const unread = checkHoldings({ holdings: [holding('PETR4', null)], reserve: null }, [
      asset('a', 'PETR4', 100),
    ]);
    expect(unread).toEqual({ assets: {}, onlyBank: [], reserveAbove: null, banks: [] });
  });

  it('offers no single fix when the ticker is in two types of the Diagrama', () => {
    const check = checkHoldings({ holdings: [holding('IVVB11', 30, { subtype: 'ETF' })], reserve: null }, [
      asset('a', 'IVVB11', 10),
      asset('b', 'IVVB11', 10),
    ]);
    expect(check.assets.a).toMatchObject({ status: 'different', capital: 20, use: null });
    expect(check.assets.b).toMatchObject({ status: 'different', capital: 20, use: null });
  });

  it('never offers to add what the person marked as their Reserva in the bank list, nor a right', () => {
    const check = checkHoldings(
      {
        holdings: [
          holding('KNCR11', 50, { subtype: 'REAL_ESTATE_FUND', feedsReserve: true }),
          holding('HGRU12', 1),
        ],
        reserve: null,
      },
      [],
    );
    expect(check.onlyBank).toEqual([]);
  });
});

describe('the Reserva investida in the comparison', () => {
  const reserve = { ticker: 'AUPO11', quotas: 20 };

  it('counts its quotas with the Diagrama, and a fix only touches the Diagrama', () => {
    const check = checkHoldings({ holdings: [holding('AUPO11', 50, { subtype: 'ETF' })], reserve }, [
      asset('a', 'AUPO11', 10),
    ]);
    expect(check.assets.a).toMatchObject({
      status: 'different',
      bank: 50,
      capital: 30,
      reserve: 20,
      use: 30,
    });
    const fixed = checkHoldings({ holdings: [holding('AUPO11', 50, { subtype: 'ETF' })], reserve }, [
      asset('a', 'AUPO11', 30),
    ]);
    expect(fixed.assets.a.status).toBe('match');
  });

  it('is enough by itself: the reserve ticker held only as Reserva matches', () => {
    const check = checkHoldings({ holdings: [holding('AUPO11', 20, { subtype: 'ETF' })], reserve }, []);
    expect(check).toMatchObject({ assets: {}, onlyBank: [], reserveAbove: null });
  });

  it('offers to add only what the bank holds beyond the Reserva', () => {
    const check = checkHoldings({ holdings: [holding('AUPO11', 26, { subtype: 'ETF' })], reserve }, []);
    expect(check.onlyBank).toEqual([
      expect.objectContaining({ ticker: 'AUPO11', quantity: 6, bank: 26, reserve: 20 }),
    ]);
  });

  it('points at the Reserva when it holds more than the bank', () => {
    const check = checkHoldings({ holdings: [holding('AUPO11', 15, { subtype: 'ETF' })], reserve }, []);
    expect(check.reserveAbove).toEqual({ ticker: 'AUPO11', reserve: 20, bank: 15, banks: ['BTG Pactual'] });
    // With the asset in the Diagrama, its own line says it, and zeroing it is all the Diagrama can do.
    const withAsset = checkHoldings({ holdings: [holding('AUPO11', 15, { subtype: 'ETF' })], reserve }, [
      asset('a', 'AUPO11', 5),
    ]);
    expect(withAsset.reserveAbove).toBeNull();
    expect(withAsset.assets.a).toMatchObject({ status: 'different', capital: 25, use: 0 });
    const zeroed = checkHoldings({ holdings: [holding('AUPO11', 15, { subtype: 'ETF' })], reserve }, [
      asset('a', 'AUPO11', 0),
    ]);
    expect(zeroed.assets.a).toMatchObject({ status: 'different', capital: 20, use: null });
  });
});

describe('the line about when the data is from', () => {
  const now = new Date('2026-10-20T15:00:00Z').getTime();
  const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const bank = (name: string, lastUpdatedAt: string) => ({
    itemId: name,
    name,
    status: 'ok' as const,
    lastUpdatedAt,
  });

  it('names the banks that sent stocks and the oldest update', () => {
    expect(
      holdingsStatusLine(
        [bank('BTG Pactual', hoursAgo(5)), bank('Nubank', hoursAgo(1))],
        ['BTG Pactual'],
        now,
      ),
    ).toEqual({ text: 'BTG Pactual · atualizado há 5 h', warning: false });
    expect(
      holdingsStatusLine(
        [bank('BTG Pactual', hoursAgo(5)), bank('XP', hoursAgo(9))],
        ['BTG Pactual', 'XP'],
        now,
      ),
    ).toEqual({ text: 'BTG Pactual e XP · atualizado há 9 h', warning: false });
    expect(holdingsStatusLine([bank('Nubank', hoursAgo(1))], [], now)).toBeNull();
  });

  it('warns when a bank stopped sending', () => {
    const line = holdingsStatusLine([bank('BTG Pactual', hoursAgo(72))], ['BTG Pactual'], now);
    expect(line?.warning).toBe(true);
    expect(line?.text).toBe(
      'BTG Pactual: sem dados novos; as quantidades são as últimas que chegaram, de 17/10.',
    );
  });

  it('joins names without articles', () => {
    expect(bankNames(['BTG Pactual'])).toBe('BTG Pactual');
    expect(bankNames(['BTG Pactual', 'Nubank', 'XP'])).toBe('BTG Pactual, Nubank e XP');
  });
});
