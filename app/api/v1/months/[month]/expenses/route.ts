import { apiRoute, readJson } from '@/lib/server/http';
import { expenseSchema, monthKeySchema } from '@/lib/server/validation';

/**
 * A new expense of "Lançar gasto", entered in this month. Dated in an earlier month already in use,
 * it goes there, even if closed; `destination` says where (null: it stayed in this month).
 */
export const POST = apiRoute<{ month: string }>(async ({ request, params, repo }) => {
  const expense = await readJson(request, expenseSchema);
  return { destination: await repo.saveNewExpense(monthKeySchema.parse(params.month), expense) };
});
