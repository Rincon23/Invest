import { apiRoute, readJson } from '@/lib/server/http';
import { tickerSchema } from '@/lib/server/validation';

/** Changes the ticker used as an invested reserve. */
export const PUT = apiRoute(async ({ request, wallet }) => {
  const { ticker } = await readJson(request, tickerSchema);
  await wallet.setTicker(ticker);
});
