import { apiRoute, readJson } from '@/lib/server/http';
import { diagramAnswerSchema } from '@/lib/server/validation';

/** Sim, Não or no answer (null) to one question. */
export const PUT = apiRoute<{ id: string }>(async ({ request, params, diagram }) => {
  const { questionId, answer } = await readJson(request, diagramAnswerSchema);
  await diagram.setAnswer(params.id, questionId, answer);
});
