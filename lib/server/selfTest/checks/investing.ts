import { randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { priceCacheKey } from '../../../diagram/tickers';
import { buildReview } from '../../banks/review';
import type { StoredTransaction } from '../../banks/repository';
import { bankConnections, bankKeys } from '../../db/schema';
import { fetchFundamentals } from '../../fundamentals';
import { lastRun } from '../../jobRuns';
import { fetchMarketQuotes } from '../../quotes';
import { schedulerRunning } from '../../scheduler';
import { expect, expectEqual, presetTopic, type SelfCheck } from '../check';

/** Open Finance and Diagrama. */

/** The banks are read once an hour; past this, the reading stopped. */
const BANKS_LATE_MS = 2 * 60 * 60 * 1000;

function transaction(
  overrides: Partial<StoredTransaction> & Pick<StoredTransaction, 'date'>,
): StoredTransaction {
  return {
    transactionId: `autoteste-${randomUUID()}`,
    accountId: 'conta',
    amount: -10,
    currency: 'BRL',
    description: 'ALGO',
    descriptionRaw: null,
    type: 'DEBIT',
    status: 'POSTED',
    category: null,
    operationType: null,
    paymentMethod: null,
    payerName: null,
    payerDocument: null,
    receiverName: null,
    receiverDocument: null,
    merchantName: null,
    installmentNumber: null,
    totalInstallments: null,
    purchaseDate: null,
    billId: null,
    ...overrides,
  };
}

export const banksChecks: SelfCheck[] = [
  {
    id: 'banks.review',
    name: 'Conferência separa o que lançar do que fica de fora',
    run: ({ scratch }) =>
      scratch(async ({ banks, budget, wallet, today }) => {
        await banks.addPending('autoteste', null);
        await banks.updateConnection('autoteste', { status: 'ok', suggestedName: 'Banco do autoteste' });
        await banks.replaceAccounts('autoteste', [
          { accountId: 'conta', kind: 'checking', name: 'Conta', balance: 100, currency: 'BRL' },
          { accountId: 'cartao', kind: 'card', name: 'Cartão', balance: 300, currency: 'BRL' },
        ]);
        const purchase = transaction({
          accountId: 'cartao',
          amount: 45.9,
          description: 'IFOOD',
          date: today,
        });
        const pix = transaction({
          amount: 50,
          type: 'CREDIT',
          paymentMethod: 'PIX',
          payerName: 'João',
          date: today,
        });
        const billPayment = transaction({
          amount: -1200,
          category: 'Credit card payment',
          description: 'PAGAMENTO FATURA',
          date: today,
        });
        await banks.upsertTransactions([purchase, pix, billPayment]);

        const review = await buildReview({ banks, repo: budget, wallet }, { today });
        const keys = (items: { key: string }[]) => items.map((item) => item.key);
        expect(
          keys(review.expenses.missing).includes(purchase.transactionId),
          'A compra no cartão não apareceu para lançar.',
        );
        expect(
          keys(review.incomes.missing).includes(pix.transactionId),
          'O Pix recebido não apareceu para lançar.',
        );
        const leftOut = review.expenses.leftOut.find((item) => item.key === billPayment.transactionId);
        expectEqual(leftOut?.leftOut?.reason, 'bill_payment', 'Pagamento de fatura (fica de fora sozinho)');
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

export const diagramChecks: SelfCheck[] = [
  {
    id: 'diagram.contribute',
    name: 'Aporte soma na renda fixa e vira gasto em Investimentos',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { diagram, budget, month, today } = account;
        const investimentos = await presetTopic(account, 'investimentos');
        await diagram.saveTargets({ fixedIncome: 1 });
        await diagram.setFixedIncome('fixedIncome', 1000, today);
        await diagram.contribute({
          date: today,
          month,
          items: [{ type: 'fixedIncome', quantity: 250 }],
          launchExpense: true,
        });

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
        const launched = (await budget.getMonth(month))?.expenses.find(
          (item) => item.source === 'investment',
        );
        expectEqual(launched?.amount, 250, 'Gasto do aporte no mês');
        expectEqual(launched?.topicId, investimentos, 'Categoria do gasto do aporte (Investimentos)');
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
