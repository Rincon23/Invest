import { apiRoute, readJson } from '@/lib/server/http';
import { diagramContributeSchema } from '@/lib/server/validation';

/** "Aportar" / "Aportar tudo": adds the quotas, keeps the aporte in the history. */
export const POST = apiRoute(async ({ request, diagram }) => {
  return diagram.contribute(await readJson(request, diagramContributeSchema));
});
