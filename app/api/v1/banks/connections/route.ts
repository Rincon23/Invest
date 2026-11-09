import { requireBanksAccess } from '@/lib/server/banks/access';
import { startConnection } from '@/lib/server/banks/service';
import { apiRoute, HttpError } from '@/lib/server/http';
import { allowAttempt } from '@/lib/server/rateLimit';

/** Step 4, "Trazer um banco": answers where the person authorizes it (the screen goes there). */
export const POST = apiRoute(async ({ banks, access, userId }) => {
  requireBanksAccess(await access());
  if (!allowAttempt(`banks-connect:${userId}`, 10, 10 * 60_000)) {
    throw new HttpError(429, 'RATE_LIMITED', 'Muitas tentativas seguidas. Espere alguns minutos.');
  }
  return startConnection(banks, userId);
});
