import { apiRoute, readJson } from '@/lib/server/http';
import { diagramLastAmountSchema } from '@/lib/server/validation';

/** Remembers the amount of the last calculation, to fill the field next time. */
export const PUT = apiRoute(async ({ request, diagram }) => {
  const { amount } = await readJson(request, diagramLastAmountSchema);
  await diagram.saveLastAmount(amount);
});
