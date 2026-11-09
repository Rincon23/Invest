import { requireBanksAccess } from '@/lib/server/banks/access';
import { syncAndNotify } from '@/lib/server/banks/alerts';
import { getDb } from '@/lib/server/db';
import { apiRoute, HttpError } from '@/lib/server/http';
import { allowAttempt } from '@/lib/server/rateLimit';

/**
 * "Buscar novidades": the same read the hourly job does (alerts included), for this person, right
 * away. It reads what Pluggy has; it can't make a bank send anything sooner.
 */
export const POST = apiRoute(async ({ access, userId }): Promise<{ changed: string[] }> => {
  requireBanksAccess(await access());
  if (!allowAttempt(`banks-sync:${userId}`, 6, 10 * 60_000)) {
    throw new HttpError(429, 'RATE_LIMITED', 'Espere alguns minutos antes de buscar de novo.');
  }
  const results = await syncAndNotify(getDb(), userId);
  if (results === null) {
    throw new HttpError(409, 'BUSY', 'Os bancos já estão sendo lidos. Espere um pouco e veja de novo.');
  }
  return { changed: results.filter((result) => result.changed).map((result) => result.itemId) };
});
