import { apiRoute, readJson } from '@/lib/server/http';
import { diagramTargetsSchema } from '@/lib/server/validation';

/** The target of each type in the portfolio (they add up to 100%); a type left out is removed. */
export const PUT = apiRoute(async ({ request, diagram }) => {
  const { targets } = await readJson(request, diagramTargetsSchema);
  await diagram.saveTargets(targets);
});
