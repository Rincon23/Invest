import { getDb } from '@/lib/server/db';
import { createFact, listFacts } from '@/lib/server/factsRepository';
import { apiRoute, HttpError, readJson } from '@/lib/server/http';
import { factSchema } from '@/lib/server/validation';

/** Administração: every "Você sabia?" and a new one. For anyone but the owner, this does not exist. */
export const GET = apiRoute(async ({ access }) => {
  if (!(await access()).owner) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  return { facts: await listFacts(getDb()) };
});

export const POST = apiRoute(async ({ request, access }) => {
  if (!(await access()).owner) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  return { fact: await createFact(getDb(), await readJson(request, factSchema)) };
});
