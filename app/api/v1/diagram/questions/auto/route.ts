import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { diagramAutoQuestionSchema } from '@/lib/server/validation';

/** Turns on an automatic question (Graham for Ações nacionais, P/VP for FIIs): VIP only. */
export const POST = apiRoute(async ({ request, diagram, access }) => {
  const { kind } = await readJson(request, diagramAutoQuestionSchema);
  if (!(await access()).vip) {
    throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  }
  return diagram.enableAutoQuestion(kind);
});
