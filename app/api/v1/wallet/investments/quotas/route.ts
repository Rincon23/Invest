import { apiRoute, readJson } from '@/lib/server/http';
import { tradeQuotasSchema } from '@/lib/server/validation';

/** Buys (positive delta) or sells (negative delta) quotas of the reserve. */
export const POST = apiRoute(async ({ request, wallet }) => {
  const { delta } = await readJson(request, tradeQuotasSchema);
  await wallet.tradeQuotas(delta);
});
