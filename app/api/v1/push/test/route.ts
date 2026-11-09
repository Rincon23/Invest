import { apiRoute, HttpError, readJson } from '@/lib/server/http';
import { allowAttempt } from '@/lib/server/rateLimit';
import { pushTestSchema } from '@/lib/server/validation';

export const POST = apiRoute(async ({ request, push, userId }) => {
  const { deviceId } = await readJson(request, pushTestSchema);
  if (!allowAttempt(`push-test:${userId}`, 5, 10 * 60_000)) {
    throw new HttpError(429, 'RATE_LIMITED', 'Espere alguns minutos antes de testar de novo.');
  }
  return push.sendTest(deviceId);
});
