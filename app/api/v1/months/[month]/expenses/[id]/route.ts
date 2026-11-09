import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { expenseSchema, monthKeySchema } from '@/lib/server/validation';

type Params = { month: string; id: string };

/** Creates or updates the expense `id` in the month. */
export const PUT = apiRoute<Params>(async ({ request, params, repo }) => {
  const expense = await readJson(request, expenseSchema);
  if (expense.id !== params.id) {
    throw new HttpError(400, 'INVALID_INPUT', 'O id do gasto não confere com o endereço.');
  }
  await repo.saveExpense(monthKeySchema.parse(params.month), expense);
});

export const DELETE = apiRoute<Params>(async ({ params, repo }) => {
  await repo.deleteExpense(monthKeySchema.parse(params.month), params.id);
});
