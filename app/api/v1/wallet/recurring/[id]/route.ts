import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { recurringExpenseSchema } from '@/lib/server/validation';

type Params = { id: string };

export const PUT = apiRoute<Params>(async ({ request, params, wallet }) => {
  const item = await readJson(request, recurringExpenseSchema);
  if (item.id !== params.id) {
    throw new HttpError(400, 'INVALID_INPUT', 'O id da conta não confere com o endereço.');
  }
  await wallet.saveRecurring(item);
});

export const DELETE = apiRoute<Params>(async ({ params, wallet }) => {
  await wallet.deleteRecurring(params.id);
});
