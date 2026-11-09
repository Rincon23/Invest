import { apiRoute, readJson } from '@/lib/server/http';
import { diagramRecommendedSchema } from '@/lib/server/validation';

/** "Usar as recomendadas": copies the recommended questions of one type into the account. */
export const POST = apiRoute(async ({ request, diagram }) => {
  const { type } = await readJson(request, diagramRecommendedSchema);
  return { added: await diagram.useRecommended(type) };
});
