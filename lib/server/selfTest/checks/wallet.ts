import { nextMonth } from '../../../budget/date';
import { createId } from '../../../budget/id';
import { recurringChecklist } from '../../../budget/recurring';
import { RESERVE_CONTRIBUTION_LABEL } from '../../../budget/reserve';
import type { CreditCard } from '../../../budget/types';
import { fetchQuote } from '../../quotes';
import { DEFAULT_TICKER } from '../../walletRepository';
import { expect, expectEqual, type SelfCheck } from '../check';

/** Cartão, Contas do mês and Reserva: what the Carteira screens read from `getSnapshot`. */

function card(): CreditCard {
  return {
    id: createId(),
    name: 'Cartão do autoteste',
    dueDay: 10,
    dueMonth: 'next',
    notifyEnabled: false,
    notifyBeforeDays: 0,
    isDefault: true,
    order: 0,
  };
}

export const cardChecks: SelfCheck[] = [
  {
    id: 'card.bill',
    name: 'Fatura soma compras e parcelas, e sai da dívida quando paga',
    run: ({ scratch }) =>
      scratch(async ({ budget, wallet, month, today }) => {
        const gold = card();
        await wallet.saveCard(gold);
        await budget.saveExpense(month, {
          id: createId(),
          categoryKind: 'fixedCost',
          description: 'Farmácia',
          amount: 200,
          date: today,
          singleInstallmentCard: true,
          cardId: gold.id,
        });
        // 3 × R$ 100, the first in this month's bill.
        await wallet.saveInstallment({
          id: createId(),
          name: 'Fone',
          categoryKind: 'fixedCost',
          firstDebitDate: `${month}-01`,
          count: 3,
          totalAmount: 300,
          accounting: 'installment',
          cardId: gold.id,
        });

        const snapshot = await wallet.getSnapshot();
        const bill = (target: string) =>
          snapshot.bills.find((item) => item.cardId === gold.id && item.month === target);
        expectEqual(bill(month)?.total, 300, 'Fatura deste mês (compra + 1ª parcela)');
        expectEqual(bill(nextMonth(month))?.total, 100, 'Fatura do mês que vem (2ª parcela)');
        // The Reserva keeps debts as negative amounts.
        expectEqual(Math.abs(snapshot.cash.report.installmentDebt), 200, 'Parcelas que ainda vêm');

        const debt = Math.abs(snapshot.cash.report.cardDebt);
        await wallet.payBill({ cardId: gold.id, month });
        const after = await wallet.getSnapshot();
        const paid = after.bills.find((item) => item.cardId === gold.id && item.month === month);
        expect(paid?.paid, '"Fatura paga" não marcou a fatura como paga.');
        expectEqual(
          Math.abs(after.cash.report.cardDebt),
          debt - 300,
          'Dívida do cartão depois de pagar a fatura',
        );
      }),
  },
];

export const recurringChecks: SelfCheck[] = [
  {
    id: 'recurring.launch',
    name: 'Conta do mês lança uma vez só',
    run: ({ scratch }) =>
      scratch(async ({ budget, wallet, month, today }) => {
        const id = createId();
        await wallet.saveRecurring({
          id,
          categoryKind: 'fixedCost',
          description: 'Internet',
          amount: 99.9,
          card: false,
          dueDay: 5,
        });
        expectEqual(await wallet.launchRecurring(id, month, today), 'launched', 'Primeiro "Lançar"');
        expectEqual(
          await wallet.launchRecurring(id, month, today),
          'already',
          'Segundo "Lançar" no mesmo mês',
        );

        const launched =
          (await budget.getMonth(month))?.expenses.filter((item) => item.recurringId === id) ?? [];
        expectEqual(launched.length, 1, 'Gastos lançados da conta');
        expectEqual(launched[0]?.amount, 99.9, 'Valor lançado');

        const snapshot = await wallet.getSnapshot();
        const checklist = recurringChecklist(snapshot.recurring, snapshot.recurringLaunches, month, today);
        expectEqual(checklist.pending.length, 0, 'Contas que faltam pagar');
        expectEqual(checklist.done.length, 1, 'Contas já pagas');
      }),
  },
];

export const cashChecks: SelfCheck[] = [
  {
    id: 'cash.report',
    name: 'Reserva: quanto tem e quanto falta',
    run: ({ scratch }) =>
      scratch(async ({ wallet }) => {
        await wallet.saveCashSettings({
          reserveAccountAmount: 5000,
          emergencyCosts: [
            { label: 'Aluguel', amount: 1500 },
            { label: 'Mercado', amount: 500 },
          ],
          reserveMultiplier: 6,
        });
        const { report } = (await wallet.getSnapshot()).cash;
        expectEqual(report.monthlyCost, 2000, 'Custo de um mês sem renda');
        expectEqual(report.expectedReserve, 12000, 'Reserva ideal (6 meses)');
        expectEqual(report.totalReserve, 5000, 'Reserva que já tem');
        expectEqual(report.gap, -7000, 'Quanto falta');
      }),
  },
  {
    id: 'cash.plan',
    name: 'Plano de recompor a reserva lança a parcela no mês',
    run: ({ scratch }) =>
      scratch(async ({ budget, wallet, month, today }) => {
        await wallet.saveReservePlan({ targetAmount: 1200, months: 6, startMonth: month });
        expectEqual((await wallet.getSnapshot()).cash.plan?.monthly, 200, 'Parcela do plano');
        await wallet.contributeToReserve({ amount: 200, month, date: today, categoryKind: 'unforeseen' });

        const plan = (await wallet.getSnapshot()).cash.plan;
        expectEqual(plan?.contributed, 200, 'Já voltou para a reserva');
        expectEqual(plan?.remaining, 1000, 'Ainda falta');
        const launched = (await budget.getMonth(month))?.expenses.find(
          (item) => item.description === RESERVE_CONTRIBUTION_LABEL,
        );
        expectEqual(launched?.amount, 200, 'Gasto "Recompor a reserva" no mês');
      }),
  },
  {
    id: 'cash.quotes',
    name: 'Cotação da reserva investida (B3 ou Yahoo)',
    external: true,
    async run() {
      const quote = await fetchQuote(DEFAULT_TICKER);
      expect(quote.price > 0, `A cotação de ${DEFAULT_TICKER} veio zerada.`);
    },
  },
];
