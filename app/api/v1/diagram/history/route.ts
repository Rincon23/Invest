import { z } from 'zod';
import { HISTORY_RANGE_KEYS, type HistoryRange } from '@/lib/diagram';
import { apiRoute } from '@/lib/server/http';

const historySchema = z.object({
  range: z.enum(HISTORY_RANGE_KEYS as [HistoryRange, ...HistoryRange[]]),
});

/** The Histórico's Investimentos tab: past prices of the account's assets, in R$ (Yahoo: free, no token). */
export const GET = apiRoute(async ({ request, diagram }) => {
  const { range } = historySchema.parse({ range: request.nextUrl.searchParams.get('periodo') });
  return diagram.getHistory(range);
});
