import { count, eq } from 'drizzle-orm';
import { checkHoldings } from '../../../banks/holdings';
import { priceCacheKey } from '../../../diagram/tickers';
import { bankConnections, bankKeys } from '../../db/schema';
import { fetchFundamentals } from '../../fundamentals';
import { lastRun } from '../../jobRuns';
import { quotesFor } from '../../quoteService';
import { fetchMarketQuotes, fetchPriceHistory } from '../../quotes';
import { schedulerRunning } from '../../scheduler';
import { expect, expectEqual, type SelfCheck } from '../check';

/** Diagrama, Histórico and Open Finance. */

/** The banks are read once an hour; past this, the reading stopped. */
const BANKS_LATE_MS = 2 * 60 * 60 * 1000;

export const diagramChecks: SelfCheck[] = [
  {
    id: 'diagram.contribute',
    name: 'Aporte soma na renda fixa e fica no histórico',
    run: ({ scratch }) =>
      scratch(async ({ diagram, today }) => {
        await diagram.saveTargets({ fixedIncome: 1 });
        await diagram.setFixedIncome('fixedIncome', 1000, today);
        await diagram.contribute({ date: today, items: [{ type: 'fixedIncome', quantity: 250 }] });

        const overview = await diagram.getOverview(false);
        expectEqual(
          overview.fixedIncome.find((item) => item.type === 'fixedIncome')?.amount,
          1250,
          'Renda fixa depois do aporte',
        );
        expectEqual(
          overview.contributions.map((item) => item.amount),
          [250],
          'Aportes no histórico',
        );
      }),
  },
  {
    id: 'diagram.quotes',
    name: 'Cotações de ações da B3 e dos EUA',
    external: true,
    async run() {
      const wanted = [
        { market: 'b3' as const, ticker: 'PETR4' },
        { market: 'us' as const, ticker: 'AAPL' },
      ];
      const found = await fetchMarketQuotes(wanted);
      const missing = wanted.filter(
        (item) => !(found.get(priceCacheKey(item.market, item.ticker))?.price ?? 0),
      );
      expect(missing.length === 0, `Sem cotação de ${missing.map((item) => item.ticker).join(' e ')}.`);
    },
  },
  {
    id: 'diagram.quoteService',
    name: 'Serviço de cotações do Capital +',
    external: true,
    run: ({ scratch }) =>
      scratch(async ({ db }) => {
        const { quotes, missing } = await quotesFor(db, ['PETR4', 'AUPO11']);
        expectEqual(missing, [], 'Tickers sem cotação');
        expect(
          quotes.every((quote) => quote.price > 0),
          'O serviço respondeu um preço zerado.',
        );
      }),
  },
  {
    id: 'diagram.fundamentals',
    name: 'Indicadores do Fundamentus (Graham e P/VP)',
    external: true,
    async run() {
      const found = (await fetchFundamentals(['PETR4'])).get('PETR4');
      expect(found, 'O Fundamentus não respondeu sobre PETR4 (o site pode ter mudado).');
      expect(
        found.lpa !== null && found.vpa !== null,
        'O Fundamentus respondeu, mas sem LPA ou VPA (o site pode ter mudado).',
      );
    },
  },
];

export const historyChecks: SelfCheck[] = [
  {
    id: 'history.prices',
    name: 'Preços passados para o gráfico',
    external: true,
    async run() {
      const points = (await fetchPriceHistory(['PETR4.SA'], '1mo', '1d')).get('PETR4.SA') ?? [];
      expect(points.length > 5, 'O Yahoo não mandou os preços do último mês de PETR4.');
    },
  },
];

export const banksChecks: SelfCheck[] = [
  {
    id: 'banks.holdings',
    name: 'Conferência com a corretora e o Fora do Diagrama',
    run: ({ scratch }) =>
      scratch(async ({ banks, diagram, today }) => {
        await banks.addPending('autoteste', null);
        await banks.updateConnection('autoteste', { status: 'ok', suggestedName: 'Corretora do autoteste' });
        await banks.replaceInvestments('autoteste', [
          { investmentId: 'petr', name: 'PETR4', type: 'EQUITY', subtype: 'STOCK', code: 'PETR4', quantity: 120, balance: null, balanceAt: null },
          { investmentId: 'aupo', name: 'AUPO11', type: 'ETF', subtype: 'ETF', code: 'AUPO11', quantity: 50, balance: null, balanceAt: null },
          { investmentId: 'itsa', name: 'ITSA4', type: 'EQUITY', subtype: 'STOCK', code: 'ITSA4', quantity: 10, balance: null, balanceAt: null },
        ]);
        await diagram.addAsset({ type: 'brStocks', ticker: 'PETR4', quantity: 100, stopBuying: false, isEtf: false, directScore: null }, today);
        await diagram.addAsset({ type: 'brStocks', ticker: 'AUPO11', quantity: 30, stopBuying: false, isEtf: true, directScore: 1 }, today);
        await diagram.setOutside('ITSA4', null);

        const assets = (await diagram.getOverview(false)).assets;
        const before = checkHoldings({ ...(await banks.holdings()), outside: await diagram.listOutside() }, assets);
        const aupo = Object.values(before.assets).find((item) => item.ticker === 'AUPO11');
        expectEqual(aupo?.keepOutside, 20, 'O que a diferença de AUPO11 deixa fora do Diagrama');
        expectEqual(before.onlyBank.map((item) => item.ticker), [], 'Ativos só no banco (ITSA4 está fora)');

        await diagram.setOutside('AUPO11', 20);
        const after = checkHoldings({ ...(await banks.holdings()), outside: await diagram.listOutside() }, assets);
        const petr = Object.values(after.assets).find((item) => item.ticker === 'PETR4');
        expectEqual(petr?.status, 'different', 'PETR4: 120 no banco e 100 no Diagrama');
        expectEqual(
          Object.values(after.assets).find((item) => item.ticker === 'AUPO11')?.status,
          'match',
          'AUPO11 com 20 fora do Diagrama',
        );
      }),
  },
  {
    id: 'banks.sync',
    name: 'Leitura dos bancos em dia',
    async run({ db, now }) {
      const [{ people }] = await db.select({ people: count() }).from(bankKeys);
      if (people === 0) return { status: 'skip', message: 'Ninguém ligou o Open Finance ainda.' };
      if (!schedulerRunning())
        return { status: 'skip', message: 'As tarefas em segundo plano estão desligadas aqui.' };
      const last = await lastRun(db, 'banks');
      expect(
        last && now.getTime() - last.getTime() < BANKS_LATE_MS,
        last
          ? `A leitura dos bancos não roda desde ${last.toLocaleString('pt-BR')}.`
          : 'A leitura dos bancos nunca rodou.',
      );
      const [{ failing }] = await db
        .select({ failing: count() })
        .from(bankConnections)
        .where(eq(bankConnections.status, 'error'));
      if (failing > 0) {
        return {
          status: 'warn',
          message: `${failing === 1 ? '1 banco deu' : `${failing} bancos deram`} erro na última leitura (a Pluggy tenta de novo).`,
        };
      }
    },
  },
];
