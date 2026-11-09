import { apiRoute, readJson } from '@/lib/server/http';
import { pushSubscriptionSchema } from '@/lib/server/validation';

export const POST = apiRoute(async ({ request, push }) =>
  push.registerDevice(
    await readJson(request, pushSubscriptionSchema),
    request.headers.get('user-agent')?.slice(0, 500) ?? null,
  ),
);
