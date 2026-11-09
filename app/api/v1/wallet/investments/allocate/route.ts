import { apiRoute, readJson } from '@/lib/server/http';
import { allocateSchema } from '@/lib/server/validation';

/** Moves money into a bucket: adds the quotas and charges the bucket's category. */
export const POST = apiRoute(async ({ request, wallet }) => {
  await wallet.allocate(await readJson(request, allocateSchema));
});
