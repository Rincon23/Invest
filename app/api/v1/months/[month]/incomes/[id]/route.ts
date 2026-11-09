import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { incomeSchema, monthKeySchema } from '@/lib/server/validation';

type Params = { month: string; id: string };

/** Creates or updates the income `id` in the month. */
export const PUT = apiRoute<Params>(async ({ request, params, repo }) => {
  const income = await readJson(request, incomeSchema);
  if (income.id !== params.id) {
    throw new HttpError(400, 'INVALID_INPUT', 'O id da renda não confere com o endereço.');
  }
  await repo.saveIncome(monthKeySchema.parse(params.month), income);
});

export const DELETE = apiRoute<Params>(async ({ params, repo }) => {
  await repo.deleteIncome(monthKeySchema.parse(params.month), params.id);
});
