import { computeMonthSummary } from '../../../budget/calculations';
import { nextMonth, previousMonth, shiftMonth } from '../../../budget/date';
import { createId } from '../../../budget/id';
import type { Expense } from '../../../budget/types';
import { expect, expectEqual, expectRefused, presetTopic, type SelfCheck } from '../check';

/**
 * Dinheiro do mês: Lançamentos, Gastos por categoria, A receber and Histórico. Each test writes
 * the way the screens do and reads it back the way the screens read it.
 */

function expense(overrides: Partial<Expense> & Pick<Expense, 'amount' | 'date'>): Expense {
  return { id: createId(), categoryKind: 'fixedCost', description: 'Autoteste', ...overrides };
}

export const expensesChecks: SelfCheck[] = [
  {
    id: 'expenses.month',
    name: 'Renda e gasto entram no mês e no resumo',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { budget, month, today } = account;
        const diversos = await presetTopic(account, 'diversos');
        await budget.saveIncome(month, { id: createId(), source: 'Salário', amount: 3000, date: today });
        const groceries = expense({
          categoryKind: 'topic',
          topicId: diversos,
          description: 'Mercado',
          amount: 120.5,
          date: today,
        });
        await budget.saveExpense(month, groceries);
        await budget.saveExpense(month, expense({ description: 'Aluguel', amount: 1000, date: today }));

        const data = await budget.getMonth(month);
        expect(data, 'O mês não foi criado ao lançar a primeira renda.');
        expectEqual(data.incomes.length, 1, 'Rendas no mês');
        expectEqual(data.expenses.length, 2, 'Gastos no mês');
        const summary = computeMonthSummary(data);
        expectEqual(summary.incomeTotal, 3000, 'Total de rendas');
        expectEqual(summary.expenseTotal, 1120.5, 'Total de gastos');

        await budget.deleteExpense(month, groceries.id);
        expectEqual((await budget.getMonth(month))?.expenses.length, 1, 'Gastos depois de excluir um');
      }),
  },
  {
    id: 'expenses.tags',
    name: 'Tag entra até em mês fechado e não muda nenhum número',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { budget, month } = account;
        const past = previousMonth(month);
        const diversos = await presetTopic(account, 'diversos');
        await budget.saveIncome(past, {
          id: createId(),
          source: 'Salário',
          amount: 2000,
          date: `${past}-05`,
        });
        const groceries = expense({
          categoryKind: 'topic',
          topicId: diversos,
          description: 'Mercado',
          amount: 80,
          date: `${past}-10`,
        });
        await budget.saveExpense(past, groceries);
        await budget.closeMonth(past, true);
        const before = computeMonthSummary((await budget.getMonth(past))!);
        const carried = (await budget.getMonth(month))?.carryIn[diversos];

        const tags = await budget.saveTag({ id: createId(), name: 'Mercado', kind: 'expense', order: 0 });
        await budget.setEntryTags(past, 'expense', groceries.id, [tags[0].id]);

        const data = await budget.getMonth(past);
        expect(data, 'O mês fechado sumiu.');
        expectEqual(
          data.expenses.find((item) => item.id === groceries.id)?.tagIds,
          [tags[0].id],
          'Tags do gasto',
        );
        const after = computeMonthSummary(data);
        expectEqual(after.expenseTotal, before.expenseTotal, 'Total gasto depois da tag');
        expectEqual(after.availableTotal, before.availableTotal, 'Ainda dá para gastar depois da tag');
        expectEqual((await budget.getMonth(month))?.carryIn[diversos], carried, 'Sobra levada depois da tag');
      }),
  },
  {
    id: 'expenses.closed',
    name: 'Mês fechado não aceita lançamento',
    run: ({ scratch }) =>
      scratch(async ({ budget, month }) => {
        const past = previousMonth(month);
        await budget.ensureMonth(past);
        await budget.closeMonth(past);
        await expectRefused(
          budget.saveExpense(past, expense({ amount: 10, date: `${past}-10` })),
          'Um mês fechado aceitou um gasto novo.',
        );
        await budget.reopenMonth(past);
        await budget.saveExpense(past, expense({ amount: 10, date: `${past}-10` }));
        expectEqual((await budget.getMonth(past))?.expenses.length, 1, 'Gastos no mês reaberto');
      }),
  },
  {
    id: 'expenses.late',
    name: 'Gasto com data do mês fechado entra nele',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { budget, month } = account;
        const diversos = await presetTopic(account, 'diversos');
        const past = previousMonth(month);
        await budget.saveIncome(past, {
          id: createId(),
          source: 'Salário',
          amount: 1000,
          date: `${past}-05`,
        });
        await budget.closeMonth(past, true);
        const carried = (await budget.getMonth(month))?.carryIn[diversos] ?? 0;

        const late = expense({ categoryKind: 'topic', topicId: diversos, amount: 30, date: `${past}-28` });
        const destination = await budget.saveNewExpense(month, late);
        expectEqual(destination?.month, past, 'Mês para onde foi o gasto');
        expectEqual((await budget.getMonth(past))?.expenses.length, 1, 'Gastos no mês fechado');
        expectEqual((await budget.getMonth(month))?.expenses.length ?? 0, 0, 'Gastos no mês de hoje');
        expectEqual(
          (await budget.getMonth(month))?.carryIn[diversos],
          carried - 30,
          'Sobra que veio do mês fechado',
        );

        await budget.undoLateExpense(past, late.id);
        expectEqual((await budget.getMonth(month))?.carryIn[diversos], carried, 'Sobra depois de desfazer');
      }),
  },
];

export const budgetChecks: SelfCheck[] = [
  {
    id: 'budget.categories',
    name: '"Ainda posso gastar" de cada categoria',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { budget, month, today } = account;
        const settings = await budget.getSettings();
        const active = settings.topics.filter((topic) => !topic.archived);
        expect(active.length > 0, 'A conta nova ficou sem categorias.');
        expectEqual(
          active.reduce((total, topic) => total + topic.targetPct, 0),
          1,
          'Soma das metas das categorias padrão',
        );

        const diversos = await presetTopic(account, 'diversos');
        await budget.saveIncome(month, { id: createId(), source: 'Salário', amount: 2000, date: today });
        await budget.saveExpense(month, expense({ description: 'Conta de luz', amount: 200, date: today }));
        await budget.saveExpense(
          month,
          expense({
            categoryKind: 'topic',
            topicId: diversos,
            description: 'Cinema',
            amount: 100,
            date: today,
          }),
        );

        const summary = computeMonthSummary((await budget.getMonth(month))!, settings.topics);
        // The fixed cost comes out of every category by its share; what is left is split by the targets.
        expectEqual(summary.availableTotal, 1800, 'Total disponível nas categorias');
        expectEqual(summary.balance, 1700, 'Saldo geral');
        const result = summary.topics.find((topic) => topic.topicId === diversos);
        expect(result, 'A categoria Prazeres e Confortos sumiu do resumo do mês.');
        expectEqual(result.spent, 100, 'Gasto em Prazeres e Confortos');
        expectEqual(
          result.remaining,
          result.available - 100,
          'O que ainda dá para gastar em Prazeres e Confortos',
        );
      }),
  },
  {
    id: 'budget.fixed-topics',
    name: 'As quatro categorias ficam sempre, com os nomes delas',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { budget } = account;
        const diversos = await presetTopic(account, 'diversos');
        const settings = await budget.getSettings();
        await budget.saveSettings({
          ...settings,
          topics: [
            ...settings.topics
              .filter((topic) => topic.id !== diversos)
              .map((topic) => ({ ...topic, name: 'Outro nome', archived: true })),
            { id: createId(), name: 'Criada', targetPct: 0.1, order: 9 },
          ],
        });
        const saved = (await budget.getSettings()).topics;
        expectEqual(saved.length, 4, 'Quantas categorias a conta tem');
        expect(
          saved.some((topic) => topic.id === diversos),
          'Prazeres e Confortos foi apagada.',
        );
        expect(
          saved.every((topic) => !topic.archived),
          'Uma das quatro categorias ficou arquivada.',
        );
        expect(
          !saved.some((topic) => topic.name === 'Outro nome'),
          'Uma das quatro categorias foi renomeada.',
        );
      }),
  },
];

export const reimbursableChecks: SelfCheck[] = [
  {
    id: 'reimbursable.pending',
    name: '"A receber" fica fora do orçamento até ser pago',
    run: ({ scratch }) =>
      scratch(async ({ budget, month, today }) => {
        const past = previousMonth(month);
        const old = expense({
          categoryKind: 'reimbursable',
          description: 'Jantar do João',
          amount: 80,
          date: `${past}-15`,
        });
        const recent = expense({
          categoryKind: 'reimbursable',
          description: 'Ingresso da Ana',
          amount: 45,
          date: today,
        });
        await budget.saveExpense(past, old);
        await budget.saveExpense(month, recent);

        const summary = computeMonthSummary((await budget.getMonth(month))!);
        expectEqual(summary.reimbursableTotal, 45, '"A receber" do mês');
        expectEqual(summary.expenseTotal, 0, 'Gastos do mês (o "A receber" não conta)');

        // What someone still owes does not go away when the month turns.
        const pending = await budget.pendingReimbursables(month);
        expectEqual(
          pending.map((item) => item.expense.id).sort(),
          [old.id, recent.id].sort(),
          'Quem ainda deve',
        );
        await budget.setReimbursed(past, old.id, new Date().toISOString());
        expectEqual(
          (await budget.pendingReimbursables(month)).map((item) => item.expense.id),
          [recent.id],
          'Quem ainda deve depois de "Já me pagou"',
        );
        const received = await budget.receivedReimbursables(today);
        expect(
          received.some((item) => item.expense.id === old.id),
          '"Já me pagou" não aparece entre os recebidos.',
        );
      }),
  },
];

export const historyChecks: SelfCheck[] = [
  {
    id: 'history.rollover',
    name: 'Sobra de um mês passa para o seguinte',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { budget, month } = account;
        const diversos = await presetTopic(account, 'diversos');
        const first = shiftMonth(month, -2);
        const second = nextMonth(first);
        await budget.saveIncome(first, {
          id: createId(),
          source: 'Salário',
          amount: 1000,
          date: `${first}-05`,
        });
        await budget.saveExpense(
          first,
          expense({
            categoryKind: 'topic',
            topicId: diversos,
            description: 'Livro',
            amount: 50,
            date: `${first}-10`,
          }),
        );
        await budget.ensureMonth(second);

        const leftover = async () =>
          computeMonthSummary((await budget.getMonth(first))!).topics.find(
            (topic) => topic.topicId === diversos,
          )?.remaining;
        const carried = async () => (await budget.getMonth(second))?.carryIn[diversos];
        expectEqual(await carried(), 0, 'Sobra com o mês ainda aberto');
        await budget.closeMonth(first);
        expectEqual(
          await carried(),
          await leftover(),
          'Sobra de Prazeres e Confortos levada ao fechar o mês',
        );

        // Reopened, the leftovers go back to it; closing again takes what changed.
        await budget.reopenMonth(first);
        expectEqual(await carried(), 0, 'Sobra depois de reabrir o mês');
        await budget.saveExpense(
          first,
          expense({
            categoryKind: 'topic',
            topicId: diversos,
            description: 'Café',
            amount: 30,
            date: `${first}-12`,
          }),
        );
        await budget.closeMonth(first);
        expectEqual(await carried(), await leftover(), 'Sobra depois de lançar no mês reaberto');
        expectEqual(await budget.listMonths(), [first, second], 'Meses no histórico');
      }),
  },
  {
    id: 'history.dropLeftovers',
    name: 'Fechar o mês sem trazer a sobra',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { budget, month } = account;
        const diversos = await presetTopic(account, 'diversos');
        const first = shiftMonth(month, -2);
        const second = nextMonth(first);
        await budget.saveIncome(first, {
          id: createId(),
          source: 'Salário',
          amount: 1000,
          date: `${first}-05`,
        });
        await budget.ensureMonth(second);
        const carried = async () => (await budget.getMonth(second))?.carryIn[diversos] ?? 0;

        await budget.closeMonth(first, false, true);
        expectEqual(await carried(), 0, 'Sobra de Prazeres e Confortos depois de fechar sem trazer');

        await budget.reopenMonth(first);
        await budget.closeMonth(first);
        expect((await carried()) > 0, 'A sobra não passou ao fechar de novo trazendo.');
      }),
  },
  {
    id: 'history.closeAll',
    name: 'Fechar todos os meses anteriores',
    run: ({ scratch }) =>
      scratch(async (account) => {
        const { budget, month } = account;
        const diversos = await presetTopic(account, 'diversos');
        const first = shiftMonth(month, -2);
        const second = nextMonth(first);
        for (const past of [first, second]) {
          await budget.saveIncome(past, {
            id: createId(),
            source: 'Salário',
            amount: 1000,
            date: `${past}-05`,
          });
        }
        await budget.ensureMonth(month);
        expectEqual(
          (await budget.monthsToClose(month)).map((data) => data.month),
          [first, second],
          'Meses para fechar',
        );

        await budget.closeMonthsBefore(month);
        expectEqual(await budget.monthsToClose(month), [], 'Meses para fechar depois de fechar todos');
        expectEqual((await budget.getMonth(month))?.closed, false, 'O mês atual continua aberto');
        const carried = (await budget.getMonth(month))?.carryIn[diversos] ?? 0;
        const single = (await budget.getMonth(second))?.carryIn[diversos] ?? 0;
        expect(single > 0 && carried > single, 'A sobra não passou de um mês para o outro até hoje.');
      }),
  },
];
