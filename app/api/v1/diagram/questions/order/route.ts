import { apiRoute, readJson } from '@/lib/server/http';
import { diagramReorderSchema } from '@/lib/server/validation';

/** The new order of one type's questions. */
export const PUT = apiRoute(async ({ request, diagram }) => {
  const { type, ids } = await readJson(request, diagramReorderSchema);
  await diagram.reorderQuestions(type, ids);
});
