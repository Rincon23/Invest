import { requireBanksAccess } from '@/lib/server/banks/access';
import { checkAndSaveKey } from '@/lib/server/banks/service';
import { apiRoute, HttpError, readJson } from '@/lib/server/http';
import { allowAttempt } from '@/lib/server/rateLimit';
import { bankKeySchema } from '@/lib/server/validation';

/** Step 3: Pluggy checks the key, then it is saved encrypted. The Secret never comes back. */
export const PUT = apiRoute(async ({ request, banks, access, userId }) => {
  requireBanksAccess(await access());
  if (!allowAttempt(`banks-key:${userId}`, 10, 10 * 60_000)) {
    throw new HttpError(429, 'RATE_LIMITED', 'Muitas tentativas seguidas. Espere alguns minutos.');
  }
  await checkAndSaveKey(banks, userId, await readJson(request, bankKeySchema));
});
