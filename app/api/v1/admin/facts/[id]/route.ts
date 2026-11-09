import { getDb } from '@/lib/server/db';
import { deleteFact, updateFact } from '@/lib/server/factsRepository';
import { apiRoute, HttpError, readJson } from '@/lib/server/http';
import { factSchema } from '@/lib/server/validation';

/** Administração: changes or deletes a "Você sabia?". */
export const PUT = apiRoute<{ id: string }>(async ({ request, params, access }) => {
  if (!(await access()).owner) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  return { fact: await updateFact(getDb(), params.id, await readJson(request, factSchema)) };
});

export const DELETE = apiRoute<{ id: string }>(async ({ params, access }) => {
  if (!(await access()).owner) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  await deleteFact(getDb(), params.id);
  return { deleted: true };
});
