import { describe, expect, it } from 'vitest';
import { TARGET_PROFILES, targetsComplete } from '../assetTypes';
import { buildPlan, splitByScore, stepQuantity, suggestContribution, type PlanPosition } from '../plan';
import { assetScore, buyWeight } from '../score';
import type { AssetType, DiagramTargets } from '../types';

/** A whole-quota B3 asset worth `quantity × price`. */
function stock(id: string, price: number | null, quantity: number, score: number | null, extra: Partial<PlanPosition> = {}): PlanPosition {
  return {
    id,
    type: 'brStocks',
    label: id,
    value: price === null ? 0 : quantity * price,
    price,
    fractionDigits: 0,
    unit: 'quota',
    score,
    stopBuying: false,
    ...extra,
  };
}

function fractional(id: string, type: AssetType, price: number, quantity: number, score: number | null, extra: Partial<PlanPosition> = {}): PlanPosition {
  return stock(id, price, quantity, score, { type, fractionDigits: type === 'crypto' ? 8 : 6, ...extra });
}

function fixed(type: AssetType, value: number): PlanPosition {
  return { id: type, type, label: type, value, price: null, fractionDigits: 2, unit: 'money', score: null, stopBuying: false };
}

const sumBy = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('splitByScore — conferência da planilha (08/10/2026)', () => {
  // Ações BR as the spreadsheet scores them, in fourteenths (14 topics, weight 1 each).
  const brScores: [string, number][] = [
    ['SAPR3', 6], ['SBSP3', 4], ['CPFE3', 14], ['EGIE3', 8], ['BPAC3', 13], ['BBAS3', 8], ['BBSE3', 4],
    ['PSSA3', 2], ['B3SA3', 10], ['ITSA3', 12], ['RADL3', 14], ['SAUD3', 12], ['WEGE3', 14], ['TGMA3', 2],
    ['ABEV3', 6], ['MDIA3', 12], ['SLCE3', 10], ['LEVE3', 2], ['VIVA3', 8], ['EZTC3', 4], ['VALE3', 4],
    ['KLBN3', 12], ['TIMS3', 4], ['ITUB3', 10], ['PETR3', 2], ['AUVP11', 14],
  ];
  // "Desabilitar" in the spreadsheet: the score counts as 0.
  const disabled: [string, AssetType, number][] = [
    ['CMIG3', 'brStocks', -2 / 14], ['CMIN3', 'brStocks', 0], ['BBDC3', 'brStocks', 4 / 14],
    ['QTUM', 'intlStocks', 1], ['BOTZ', 'intlStocks', 1], ['WTAI', 'intlStocks', 1],
    ['DEBB11', 'fixedIncome', 1], ['BTC', 'crypto', 1],
  ];
  const targets: DiagramTargets = { brStocks: 0.45, fiis: 0.1, intlStocks: 0.15, fixedIncome: 0.25, crypto: 0.05 };
  const items = [
    ...brScores.map(([id, score]) => ({ id, type: 'brStocks' as AssetType, weight: score / 14 })),
    { id: 'HGRU11', type: 'fiis' as AssetType, weight: 1.419067549 },
    { id: 'KNRI11', type: 'fiis' as AssetType, weight: 1.349858808 },
    { id: 'PMLL11', type: 'fiis' as AssetType, weight: 2.013752707 },
    { id: 'HGLG11', type: 'fiis' as AssetType, weight: 1.8221188 },
    { id: 'VOO', type: 'intlStocks' as AssetType, weight: 10 },
    { id: 'IYJ', type: 'intlStocks' as AssetType, weight: 5 },
    { id: 'Renda fixa', type: 'fixedIncome' as AssetType, weight: 10 },
    { id: 'ABTC11', type: 'crypto' as AssetType, weight: 1 },
    ...disabled.map(([id, type, score]) => ({ id, type, weight: buyWeight(score, true) })),
  ];
  const shares = splitByScore(targets, items);

  it('gives each asset the % desejado of the spreadsheet', () => {
    expect(shares.SAPR3).toBeCloseTo(0.0128, 4);
    expect(shares.CPFE3).toBeCloseTo(0.0299, 4);
    expect(shares.HGLG11).toBeCloseTo(0.0276, 4);
    expect(shares.VOO).toBeCloseTo(0.1, 6);
    expect(shares.IYJ).toBeCloseTo(0.05, 6);
    expect(shares['Renda fixa']).toBeCloseTo(0.25, 6);
    expect(shares.ABTC11).toBeCloseTo(0.05, 6);
  });

  it('gives nothing to the disabled ones and adds up to 100%', () => {
    for (const id of ['CMIG3', 'CMIN3', 'BBDC3', 'QTUM', 'BOTZ', 'WTAI', 'DEBB11', 'BTC']) expect(shares[id]).toBe(0);
    expect(sumBy(Object.values(shares))).toBeCloseTo(1, 9);
  });

  it('weighs a score of 1 twice as much as 0,5', () => {
    const split = splitByScore({ brStocks: 1 }, [
      { id: 'A', type: 'brStocks', weight: 1 },
      { id: 'B', type: 'brStocks', weight: 0.5 },
    ]);
    expect(split.A).toBeCloseTo(2 * split.B, 9);
  });
});

describe('suggestContribution', () => {
  it('never spends more than the aporte and leaves less than the cheapest quota that still has room', () => {
    const input = {
      amount: 1_000,
      targets: { brStocks: 0.6, fiis: 0.4 },
      positions: [
        stock('WEGE3', 51.77, 13, 1),
        stock('ITSA3', 16.14, 38, 6 / 7),
        stock('KLBN3', 3.8, 140, 6 / 7),
        stock('HGLG11', 155.5, 4, 1, { type: 'fiis' }),
        stock('KNRI11', 163.25, 3, 0.8, { type: 'fiis' }),
      ],
    };
    const { plan } = suggestContribution(input);
    expect(plan.spent).toBeLessThanOrEqual(1_000 + 1e-9);
    expect(plan.leftover).toBeGreaterThanOrEqual(0);
    const roomLeft = plan.lines.filter(
      (line) => line.target - line.value - line.amount > 0.005 && (!line.blocked || line.blocked === 'waiting'),
    );
    const cheapest = Math.min(...roomLeft.map((line) => line.price ?? Infinity));
    expect(plan.leftover).toBeLessThan(cheapest);
    for (const line of plan.lines) expect(Number.isInteger(line.quantity)).toBe(true);
  });

  it('keeps the R$ 70 that do not buy a R$ 100 quota as leftover, never going negative', () => {
    const { plan } = suggestContribution({
      amount: 70,
      targets: { brStocks: 1 },
      positions: [stock('ABCD3', 100, 10, 1)],
    });
    expect(plan.spent).toBe(0);
    expect(plan.leftover).toBe(70);
    expect(plan.leftoverReason).toEqual({ kind: 'quotaTooExpensive', id: 'ABCD3', label: 'ABCD3', price: 100 });
  });

  it('fills first whoever is furthest from the target', () => {
    const { plan } = suggestContribution({
      amount: 100,
      targets: { brStocks: 1 },
      positions: [stock('LONGE3', 1, 0, 1), stock('PERTO3', 1, 450, 1)],
    });
    // Target of each: (450 + 100) / 2 = 275. LONGE3 is 275 below, PERTO3 above: all goes to LONGE3.
    expect(plan.lines.find((line) => line.id === 'LONGE3')!.quantity).toBe(100);
    expect(plan.lines.find((line) => line.id === 'PERTO3')!.quantity).toBe(0);
  });

  describe('"Não compro mais"', () => {
    // Ações internacionais at 15%: VOO + IYJ at 13,7% and QTUM + BOTZ + WTAI (marked) at 6,7%.
    const intl = (stopped: boolean, target = 0.15) => ({
      amount: 1_000,
      targets: { brStocks: 1 - target, intlStocks: target } as DiagramTargets,
      positions: [
        stock('WEGE3', 10, 796, 1),
        fractional('VOO', 'intlStocks', 100, 9, 1),
        fractional('IYJ', 'intlStocks', 47, 10, 1),
        fractional('QTUM', 'intlStocks', 100, 3, 1, { stopBuying: stopped }),
        fractional('BOTZ', 'intlStocks', 100, 2, 1, { stopBuying: stopped }),
        fractional('WTAI', 'intlStocks', 85, 2, 1, { stopBuying: stopped }),
      ],
    });

    it('is never bought, and its value still fills the type: VOO and IYJ get nothing', () => {
      const { plan } = suggestContribution(intl(true));
      for (const id of ['VOO', 'IYJ', 'QTUM', 'BOTZ', 'WTAI']) {
        expect(plan.lines.find((line) => line.id === id)!.amount).toBe(0);
      }
      for (const id of ['QTUM', 'BOTZ', 'WTAI']) expect(plan.lines.find((line) => line.id === id)!.blocked).toBe('stopped');
      // Everything went to the Ações nacionais, the only type below its target.
      expect(plan.lines.find((line) => line.id === 'WEGE3')!.amount).toBeCloseTo(1_000, 6);
    });

    it('zeroes the weight but not the score; unmarking gives the score back', () => {
      const asset = { isEtf: true, directScore: 0.8 };
      expect(assetScore(asset, []).score).toBe(0.8);
      expect(buyWeight(0.8, true)).toBe(0);
      expect(buyWeight(0.8, false)).toBe(0.8);
      // With the type below its target, the unmarked ones can receive again (VOO is above its share).
      const { plan } = suggestContribution(intl(false, 0.25));
      const bought = plan.lines.filter((line) => line.type === 'intlStocks' && line.amount > 0).map((line) => line.id);
      expect(bought.length).toBeGreaterThan(0);
      expect(bought).not.toContain('VOO');
    });
  });

  it('hands the target of a type nobody can receive in to the other types, and says so', () => {
    const { plan } = suggestContribution({
      amount: 1_000,
      targets: { brStocks: 0.45, crypto: 0.1, fixedIncome: 0.45 },
      positions: [stock('WEGE3', 1, 1_000, 1), fixed('fixedIncome', 1_000)],
    });
    const crypto = plan.types.find((type) => type.type === 'crypto')!;
    expect(crypto.orphan).toBe('empty');
    expect(crypto.effectiveTarget).toBe(0);
    expect(plan.types.find((type) => type.type === 'brStocks')!.effectiveTarget).toBeCloseTo(0.5, 9);
    expect(plan.spent).toBeCloseTo(1_000, 6);
  });

  it('says why nothing was bought when no asset has a positive score', () => {
    const { plan } = suggestContribution({
      amount: 500,
      targets: { brStocks: 1 },
      positions: [stock('RUIM3', 10, 5, -0.4), stock('ZERO3', 10, 5, 0), stock('NOVA3', 10, 0, null)],
    });
    expect(plan.spent).toBe(0);
    expect(plan.leftover).toBe(500);
    expect(plan.leftoverReason).toEqual({ kind: 'noReceivers' });
    expect(plan.types[0].orphan).toBe('mixed');
    expect(plan.lines.map((line) => line.blocked)).toEqual(['lowScore', 'lowScore', 'noScore']);
  });

  it('never buys an asset without a quote', () => {
    const { plan } = suggestContribution({
      amount: 300,
      targets: { brStocks: 1 },
      positions: [stock('SEMCOT3', null, 10, 1), stock('WEGE3', 50, 1, 0.5)],
    });
    const noQuote = plan.lines.find((line) => line.id === 'SEMCOT3')!;
    expect(noQuote.blocked).toBe('noPrice');
    expect(noQuote.amount).toBe(0);
    expect(plan.lines.find((line) => line.id === 'WEGE3')!.quantity).toBe(6);
  });

  it('scores an ETF and an asset of a type without questions by the direct score', () => {
    const questions = [{ id: 'q1', type: 'brStocks' as const, criterion: 'ROE', text: 'ROE > 10%?', weight: 1, position: 0 }];
    expect(assetScore({ isEtf: true, directScore: 0.6 }, questions, { q1: -1 })).toMatchObject({ source: 'direct', score: 0.6 });
    expect(assetScore({ isEtf: false, directScore: 0.3 }, [], {})).toMatchObject({ source: 'direct', score: 0.3 });
    expect(assetScore({ isEtf: false, directScore: 0.3 }, questions, { q1: -1 })).toMatchObject({ source: 'questions', score: -1 });
    const { plan } = suggestContribution({
      amount: 200,
      targets: { brStocks: 1 },
      positions: [stock('AUVP11', 50, 0, 0.6)],
    });
    expect(plan.lines[0].quantity).toBe(4);
  });

  it('leaves no money without a destination or an explanation in the AUVP case (types nobody can receive in)', () => {
    const moderate = TARGET_PROFILES.find((profile) => profile.key === 'moderate')!.targets;
    expect(targetsComplete(moderate)).toBe(true);
    const { plan } = suggestContribution({
      amount: 20_000,
      targets: moderate,
      positions: [
        stock('WEGE3', 51.77, 10, 1),
        stock('ITSA3', 16.14, 20, 0.8),
        stock('HGLG11', 155.5, 2, 1, { type: 'fiis' }),
        fractional('VOO', 'intlStocks', 3_570.6, 0.5, 1),
        fixed('fixedIncome', 5_000),
        fixed('intlFixedIncome', 0),
        // REITs and crypto have nobody with a positive score.
        fractional('O', 'reits', 300, 1, -0.5),
      ],
    });
    const orphans = plan.types.filter((type) => type.orphan).map((type) => type.type);
    expect(orphans.sort()).toEqual(['crypto', 'reits']);
    expect(plan.spent + plan.leftover).toBeCloseTo(20_000, 6);
    // What is left is less than one quota of the cheapest whole-quota asset with room.
    expect(plan.leftover).toBeLessThan(16.14);
    expect(plan.leftover).toBeGreaterThanOrEqual(0);
  });

  it('buys fractions of international assets and crypto, and R$ of fixed income', () => {
    const { plan } = suggestContribution({
      amount: 1_000,
      targets: { intlStocks: 0.5, crypto: 0.25, fixedIncome: 0.25 },
      positions: [
        fractional('VOO', 'intlStocks', 3_570.6256, 0, 1),
        fractional('BTC', 'crypto', 412_127, 0, 1),
        fixed('fixedIncome', 0),
      ],
    });
    const voo = plan.lines.find((line) => line.id === 'VOO')!;
    expect(voo.quantity).toBeGreaterThan(0);
    expect(voo.quantity).toBeLessThan(1);
    expect(plan.lines.find((line) => line.id === 'fixedIncome')!.amount).toBeCloseTo(250, 2);
    expect(plan.leftover).toBeLessThan(0.05);
    expect(plan.spent).toBeLessThanOrEqual(1_000);
  });

  it('recomputes the leftover live when a line is moved, and calls it unspent', () => {
    const input = { amount: 500, targets: { brStocks: 1 } as DiagramTargets, positions: [stock('WEGE3', 50, 0, 1)] };
    const { quantities, plan } = suggestContribution(input);
    expect(quantities.WEGE3).toBe(10);
    const line = plan.lines[0];
    const fewer = buildPlan(input, { WEGE3: stepQuantity(line, -1, plan.leftover) });
    expect(fewer.leftover).toBe(50);
    expect(fewer.leftoverReason).toEqual({ kind: 'unspent' });
    // "+" never goes past the aporte.
    expect(stepQuantity(line, 1, plan.leftover)).toBe(10);
  });

  describe('renda fixa com fundos (DEBB11) além dos títulos sem cotação', () => {
    it('a fund with "Não compro mais" fills the type and the rest goes to the titles without a quote', () => {
      const { plan } = suggestContribution({
        amount: 1_000,
        targets: { brStocks: 0.75, fixedIncome: 0.25 },
        positions: [
          stock('WEGE3', 10, 300, 1),
          { ...fixed('fixedIncome', 500), score: 1 },
          stock('DEBB11', 17.22, 26, 0.1, { type: 'fixedIncome', stopBuying: true }),
        ],
      });
      const debb = plan.lines.find((line) => line.id === 'DEBB11')!;
      expect(debb.blocked).toBe('stopped');
      expect(debb.amount).toBe(0);
      // Type target: 25% of (3000 + 447.72 + 500 + 1000) = 1236.93; DEBB11 holds 447.72 of it.
      const titles = plan.lines.find((line) => line.id === 'fixedIncome')!;
      expect(titles.target).toBeCloseTo(0.25 * (3_000 + 447.72 + 500 + 1_000) - 447.72, 2);
      expect(plan.spent).toBeLessThanOrEqual(1_000);
    });

    it('splits the type by score between the titles and a fund, and a total with score 0 receives nothing', () => {
      const input = (titlesScore: number) => ({
        amount: 1_000,
        targets: { fixedIncome: 1 } as DiagramTargets,
        positions: [
          { ...fixed('fixedIncome', 0), score: titlesScore },
          stock('IMAB11', 10, 0, 1, { type: 'fixedIncome' as AssetType }),
        ],
      });
      const even = suggestContribution(input(1)).plan;
      expect(even.lines.find((line) => line.id === 'fixedIncome')!.amount).toBeCloseTo(500, 2);
      expect(even.lines.find((line) => line.id === 'IMAB11')!.quantity).toBe(50);
      const off = suggestContribution(input(0)).plan;
      expect(off.lines.find((line) => line.id === 'fixedIncome')!.blocked).toBe('lowScore');
      expect(off.lines.find((line) => line.id === 'IMAB11')!.quantity).toBe(100);
    });
  });

  it('leaves out the types that are not in the portfolio', () => {
    const { plan } = suggestContribution({
      amount: 100,
      targets: { brStocks: 1 },
      positions: [stock('WEGE3', 10, 0, 1), fractional('VOO', 'intlStocks', 10, 5, 1)],
    });
    expect(plan.lines.map((line) => line.id)).toEqual(['WEGE3']);
    expect(plan.invested).toBe(0);
  });
});
