// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentMonthKey, todayISO } from '@/lib/budget';
import { RECOMMENDED_QUESTIONS, type AssetInput } from '@/lib/diagram';
import { clearAccountData } from '../accountData';
import { PostgresBudgetRepository } from '../budgetRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresDiagramRepository } from '../diagramRepository';
import { parseYahooSearch } from '../quotes';

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

// No test ever reaches B3 or Yahoo: the network is off.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('sem rede nos testes')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function newAccount() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  const budget = new PostgresBudgetRepository(db, id);
  return { id, budget, diagram: new PostgresDiagramRepository(db, id, budget) };
}

async function setPrice(ticker: string, price: number) {
  const values = { price, fetchedAt: new Date() };
  await db
    .insert(schema.priceCache)
    .values({ ticker, ...values })
    .onConflictDoUpdate({ target: schema.priceCache.ticker, set: values });
}

function asset(overrides: Partial<AssetInput> = {}): AssetInput {
  return {
    type: 'brStocks',
    ticker: 'WEGE3',
    quantity: 10,
    stopBuying: false,
    isEtf: false,
    directScore: null,
    ...overrides,
  };
}

describe('PostgresDiagramRepository', () => {
  it('starts empty: no targets, no assets, no questions', async () => {
    const { diagram } = await newAccount();
    const overview = await diagram.getOverview(false);
    expect(overview.settings).toEqual({ targets: {}, lastAmount: null });
    expect(overview.assets).toEqual([]);
    expect(overview.questions).toEqual([]);
  });

  it('only saves targets that add up to 100%, and a type left out is out of the portfolio', async () => {
    const { diagram } = await newAccount();
    await expect(diagram.saveTargets({ brStocks: 0.5, fiis: 0.4 })).rejects.toMatchObject({ code: 'TARGETS_NOT_100' });
    await diagram.saveTargets({ brStocks: 0.6, fiis: 0.4, crypto: 0 });
    expect((await diagram.getOverview(false)).settings.targets).toEqual({ brStocks: 0.6, fiis: 0.4, crypto: 0 });
  });

  it('normalizes the ticker, refuses a duplicate and converts US$ prices with the dollar', async () => {
    const { diagram } = await newAccount();
    const added = await diagram.addAsset(asset({ type: 'intlStocks', ticker: 'bats:wtai', quantity: 2 }), todayISO());
    expect(added.ticker).toBe('WTAI');
    await expect(diagram.addAsset(asset({ type: 'intlStocks', ticker: 'WTAI' }), todayISO())).rejects.toMatchObject({
      code: 'DUPLICATE_ASSET',
    });
    await setPrice('US:WTAI', 43.6);
    await setPrice('FX:USDBRL', 5);
    const overview = await diagram.getOverview(false);
    expect(overview.quotes[added.id].price).toBeCloseTo(218, 6);
    expect(overview.dollar?.price).toBe(5);
  });

  it('copies the recommended questions into one type only, once', async () => {
    const { diagram } = await newAccount();
    expect(await diagram.useRecommended('fiis')).toBe(RECOMMENDED_QUESTIONS.fiis.length);
    expect(await diagram.useRecommended('fiis')).toBe(0);
    const questions = (await diagram.getOverview(false)).questions;
    expect(questions.every((question) => question.type === 'fiis')).toBe(true);
    expect(questions.map((question) => question.position)).toEqual(questions.map((_, index) => index));
  });

  it('drops the answers with the question removed, and refuses a question of another type', async () => {
    const { diagram } = await newAccount();
    const wege = await diagram.addAsset(asset(), todayISO());
    const roe = await diagram.addQuestion({ type: 'brStocks', criterion: 'ROE', text: 'ROE > 10%?', weight: 1 });
    const pvp = await diagram.addQuestion({ type: 'fiis', criterion: 'P/VP', text: 'P/VP < 1?', weight: 1 });
    await diagram.setAnswer(wege.id, roe.id, 1);
    await expect(diagram.setAnswer(wege.id, pvp.id, 1)).rejects.toMatchObject({ code: 'WRONG_TYPE' });
    expect((await diagram.getOverview(false)).answers[wege.id]).toEqual({ [roe.id]: 1 });
    await diagram.deleteQuestion(roe.id);
    expect((await diagram.getOverview(false)).answers[wege.id]).toBeUndefined();
  });

  it('adds the quotas of an aporte, keeps it in the history and can launch it in Investimentos', async () => {
    const { budget, diagram } = await newAccount();
    await budget.saveSettings({ ...(await budget.getSettings()), modules: { expenses: true } });
    const wege = await diagram.addAsset(asset({ quantity: 10 }), '2026-01-01');
    await setPrice('WEGE3', 50);

    const contribution = await diagram.contribute({
      date: todayISO(),
      month: currentMonthKey(),
      items: [
        { assetId: wege.id, type: 'brStocks', quantity: 3 },
        { type: 'fixedIncome', quantity: 200 },
      ],
      launchExpense: true,
    });
    expect(contribution.amount).toBe(350);

    const overview = await diagram.getOverview(false);
    expect(overview.assets[0]).toMatchObject({ quantity: 13, quantityUpdatedOn: todayISO() });
    expect(overview.fixedIncome).toEqual([{ type: 'fixedIncome', amount: 200, updatedOn: todayISO(), score: 1 }]);
    expect(overview.contributions).toHaveLength(1);

    const month = await budget.getMonth(currentMonthKey());
    const investimentos = (await budget.getSettings()).topics.find((topic) => topic.preset === 'investimentos')!;
    expect(month?.expenses).toEqual([
      expect.objectContaining({ topicId: investimentos.id, amount: 350, source: 'investment' }),
    ]);
  });

  it('refuses an aporte of an asset without a quote, changing nothing', async () => {
    const { diagram } = await newAccount();
    const nova = await diagram.addAsset(asset({ ticker: 'NOVA3', quantity: 1 }), todayISO());
    await expect(
      diagram.contribute({
        date: todayISO(),
        month: currentMonthKey(),
        items: [{ assetId: nova.id, type: 'brStocks', quantity: 1 }],
        launchExpense: false,
      }),
    ).rejects.toMatchObject({ code: 'NO_QUOTE' });
    expect((await diagram.getOverview(false)).assets[0].quantity).toBe(1);
  });

  it('round-trips through the backup and goes away with "Apagar todos os dados"', async () => {
    const { id, diagram } = await newAccount();
    await diagram.saveTargets({ brStocks: 0.7, fixedIncome: 0.3 });
    const wege = await diagram.addAsset(asset({ sector: 'Bens industriais' }), todayISO());
    const roe = await diagram.addQuestion({ type: 'brStocks', criterion: 'ROE', text: 'ROE > 10%?', weight: 2 });
    await diagram.setAnswer(wege.id, roe.id, -1);
    await diagram.setFixedIncome('fixedIncome', 1_000, todayISO());
    const backup = await diagram.exportData();

    await clearAccountData(db, id);
    const empty = await diagram.getOverview(false);
    expect(empty.assets).toEqual([]);
    expect(empty.settings.targets).toEqual({});

    await diagram.importData(backup);
    expect(await diagram.exportData()).toEqual(backup);
  });
});

describe('parseYahooSearch', () => {
  const payload = {
    quotes: [
      { symbol: 'HGLG11.SA', quoteType: 'EQUITY', exchange: 'SAO', longname: 'Cshg Logistica - Fundo De Investimento Imobiliario' },
      { symbol: 'HGLG11Q.SA', quoteType: 'EQUITY', exchange: 'SAO' },
      { symbol: 'AUVP11.SA', quoteType: 'EQUITY', exchange: 'SAO', longname: 'BTG PACTUAL TEVA AUVP AÇÕES FUNDAMENTOS FUNDO DE ÍNDICE' },
      { symbol: 'VOO', quoteType: 'ETF', exchange: 'PCX', longname: 'Vanguard S&P 500 ETF' },
      { symbol: 'VOO.MX', quoteType: 'ETF', exchange: 'MEX', longname: 'Vanguard S&P 500 ETF' },
      { symbol: 'BTC-USD', quoteType: 'CRYPTOCURRENCY', exchange: 'CCC', shortname: 'Bitcoin USD' },
      { symbol: 'BTC=F', quoteType: 'FUTURE', exchange: 'CME' },
    ],
  };

  it('keeps what each market can price, and spots the ETFs', () => {
    expect(parseYahooSearch('b3', payload)).toEqual([
      { ticker: 'HGLG11', name: 'Cshg Logistica - Fundo De Investimento Imobiliario', isEtf: false },
      { ticker: 'AUVP11', name: 'BTG PACTUAL TEVA AUVP AÇÕES FUNDAMENTOS FUNDO DE ÍNDICE', isEtf: true },
    ]);
    expect(parseYahooSearch('us', payload)).toEqual([{ ticker: 'VOO', name: 'Vanguard S&P 500 ETF', isEtf: true }]);
    expect(parseYahooSearch('crypto', payload)).toEqual([{ ticker: 'BTC', name: 'Bitcoin', isEtf: false }]);
    expect(parseYahooSearch('b3', null)).toEqual([]);
  });
});

describe('perguntas automáticas (VIP)', () => {
  async function setIndicators(ticker: string, values: { lpa?: number; vpa?: number; pvp?: number }) {
    const row = { lpa: values.lpa ?? null, vpa: values.vpa ?? null, pvp: values.pvp ?? null, fetchedAt: new Date() };
    await db
      .insert(schema.fundamentalsCache)
      .values({ ticker, ...row })
      .onConflictDoUpdate({ target: schema.fundamentalsCache.ticker, set: row });
  }

  it('turns the manual P/VP question into the automatic one and answers it for VIP only', async () => {
    const { diagram } = await newAccount();
    await diagram.useRecommended('fiis');
    const hglg = await diagram.addAsset(asset({ type: 'fiis', ticker: 'HGLG11' }), todayISO());
    const manual = (await diagram.getOverview(false)).questions.find((question) => question.criterion === 'P/VP')!;
    await diagram.setAnswer(hglg.id, manual.id, -1);

    const auto = await diagram.enableAutoQuestion('pvp');
    expect(auto).toMatchObject({ id: manual.id, auto: 'pvp' });
    expect((await diagram.enableAutoQuestion('pvp')).id).toBe(manual.id);

    await setIndicators('HGLG11', { pvp: 0.95 });
    expect((await diagram.getOverview(true)).answers[hglg.id][manual.id]).toBe(1);
    // Not VIP: no indicators, and the old manual answer is what is stored.
    const plain = await diagram.getOverview(false);
    expect(plain.indicators).toEqual({});
    expect(plain.answers[hglg.id][manual.id]).toBe(-1);
    await expect(diagram.setAnswer(hglg.id, manual.id, 1)).rejects.toMatchObject({ code: 'AUTO_QUESTION' });
  });

  it('puts Graham first among the Ações nacionais and answers it with the price', async () => {
    const { diagram } = await newAccount();
    await diagram.useRecommended('brStocks');
    const graham = await diagram.enableAutoQuestion('graham');
    const questions = (await diagram.getOverview(false)).questions.filter((question) => question.type === 'brStocks');
    expect(questions.find((question) => question.position === 0)?.id).toBe(graham.id);
    expect(new Set(questions.map((question) => question.position)).size).toBe(questions.length);

    const tgma = await diagram.addAsset(asset({ ticker: 'TGMA3' }), todayISO());
    await setPrice('TGMA3', 45.25);
    await setIndicators('TGMA3', { lpa: 3.61, vpa: 13.8 });
    expect((await diagram.getOverview(true)).answers[tgma.id][graham.id]).toBe(-1);
  });

  it('takes a fixed-income fund (DEBB11) as an asset: an aporte adds quotas, not to the total', async () => {
    const { diagram } = await newAccount();
    const debb = await diagram.addAsset(asset({ type: 'fixedIncome', ticker: 'DEBB11', quantity: 26, directScore: 0.1 }), todayISO());
    await diagram.setFixedIncome('fixedIncome', 6_497.56, todayISO(), 1);
    await setPrice('DEBB11', 17.22);
    await diagram.contribute({
      date: todayISO(),
      month: currentMonthKey(),
      items: [{ assetId: debb.id, type: 'fixedIncome', quantity: 2 }],
      launchExpense: false,
    });
    const overview = await diagram.getOverview(false);
    expect(overview.assets[0]).toMatchObject({ ticker: 'DEBB11', quantity: 28 });
    expect(overview.fixedIncome[0]).toMatchObject({ amount: 6_497.56, score: 1 });
    expect(overview.quotes[debb.id].price).toBe(17.22);
    await diagram.setFixedIncome('fixedIncome', 7_000, todayISO());
    expect((await diagram.getOverview(false)).fixedIncome[0]).toMatchObject({ amount: 7_000, score: 1 });
  });

  it('converts crypto from US$ with the dollar (Yahoo has no pair in R$)', async () => {
    const { diagram } = await newAccount();
    const btc = await diagram.addAsset(asset({ type: 'crypto', ticker: 'btc-brl', quantity: 0.5 }), todayISO());
    expect(btc.ticker).toBe('BTC');
    await setPrice('CRYPTO:BTC', 60_000);
    await setPrice('FX:USDBRL', 5);
    expect((await diagram.getOverview(false)).quotes[btc.id].price).toBe(300_000);
  });

  it('prices a B3 code from B3 in any type (ABTC11 in Criptomoedas)', async () => {
    const { diagram } = await newAccount();
    const abtc = await diagram.addAsset(asset({ type: 'crypto', ticker: 'abtc11.sa', isEtf: true }), todayISO());
    expect(abtc.ticker).toBe('ABTC11');
    await setPrice('ABTC11', 124.05);
    expect((await diagram.getOverview(false)).quotes[abtc.id].price).toBe(124.05);
  });
});

describe('parseFundamentus', () => {
  const page = (rows: [string, string][]) =>
    rows
      .map(
        ([label, value]) =>
          `<td class="label w2"><span class="help tips" title="x">?</span><span class="txt">${label}</span></td>\n\t\t<td class="data w2"><span class="txt">${value}</span></td>`,
      )
      .join('\n');

  it('reads LPA, VPA and P/VP of a stock and VP/Cota of a fund', async () => {
    const { parseFundamentus } = await import('../fundamentals');
    expect(parseFundamentus('WEGE3', page([['LPA', '1,49'], ['VPA', '4,49'], ['P/VP', '11,45']]))).toEqual({
      ticker: 'WEGE3',
      lpa: 1.49,
      vpa: 4.49,
      pvp: 11.45,
    });
    expect(parseFundamentus('HGLG11', page([['P/VP', '0,95'], ['VP/Cota', '165,95']]))).toEqual({
      ticker: 'HGLG11',
      lpa: null,
      vpa: 165.95,
      pvp: 0.95,
    });
    expect(parseFundamentus('X', page([['LPA', '-0,52'], ['VPA', '-'], ['P/VP', '1.234,5']]))).toMatchObject({
      lpa: -0.52,
      vpa: null,
      pvp: 1234.5,
    });
    expect(parseFundamentus('XXXX99', '<h1>Nenhum papel encontrado</h1>')).toBeNull();
  });
});
