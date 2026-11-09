import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { installmentPlanSchema } from '@/lib/server/validation';

type Params = { id: string };

export const PUT = apiRoute<Params>(async ({ request, params, wallet }) => {
  const plan = await readJson(request, installmentPlanSchema);
  if (plan.id !== params.id) {
    throw new HttpError(400, 'INVALID_INPUT', 'O id do parcelamento não confere com o endereço.');
  }
  await wallet.saveInstallment(plan);
});

export const DELETE = apiRoute<Params>(async ({ params, wallet }) => {
  await wallet.deleteInstallment(params.id);
});
