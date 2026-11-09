import { getDb } from '@/lib/server/db';
import { apiRoute, HttpError } from '@/lib/server/http';
import { runSelfTests, SelfTestsBusyError } from '@/lib/server/selfTest/runner';

/** Administração → "Rodar agora": every automatic test, now. Only for the owner. */
export const POST = apiRoute(async ({ access }) => {
  if (!(await access()).owner) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  try {
    return await runSelfTests(getDb(), { trigger: 'manual' });
  } catch (err) {
    if (err instanceof SelfTestsBusyError) throw new HttpError(409, 'TESTS_RUNNING', err.message);
    throw err;
  }
});
