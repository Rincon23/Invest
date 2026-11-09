import { apiRoute, readJson } from '@/lib/server/http';
import { diagramQuestionSchema } from '@/lib/server/validation';

export const POST = apiRoute(async ({ request, diagram }) => {
  return diagram.addQuestion(await readJson(request, diagramQuestionSchema));
});
