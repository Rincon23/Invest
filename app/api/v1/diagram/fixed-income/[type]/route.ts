import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { diagramFixedIncomeSchema } from '@/lib/server/validation';

/** The total of a fixed-income type ("Continua igual" sends the same amount: only the date moves). */
export const PUT = apiRoute<{ type: string }>(async ({ request, params, diagram }) => {
  if (params.type !== 'fixedIncome' && params.type !== 'intlFixedIncome') {
    throw new HttpError(404, 'NOT_FOUND', 'Tipo desconhecido.');
  }
  const { amount, date, score } = await readJson(request, diagramFixedIncomeSchema);
  await diagram.setFixedIncome(params.type, amount, date, score);
});
