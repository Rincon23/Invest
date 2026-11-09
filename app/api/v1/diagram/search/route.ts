import { z } from 'zod';
import { ASSET_TYPE_KEYS, type AssetType } from '@/lib/diagram';
import { apiRoute } from '@/lib/server/http';

const searchSchema = z.object({
  type: z.enum(ASSET_TYPE_KEYS as [AssetType, ...AssetType[]]),
  q: z.string().trim().min(1).max(30),
});

/** Ticker suggestions while the person types (Yahoo's search: free, no token). */
export const GET = apiRoute(async ({ request, diagram }) => {
  const params = request.nextUrl.searchParams;
  const { type, q } = searchSchema.parse({ type: params.get('tipo'), q: params.get('q') });
  return diagram.searchTickers(type, q);
});
