import { apiRoute, readJson } from '@/lib/server/http';
import { diagramAssetSchema } from '@/lib/server/validation';

/** Adds an asset (and prices it right away when a source answers). */
export const POST = apiRoute(async ({ request, diagram }) => {
  const { date, ...input } = await readJson(request, diagramAssetSchema);
  return diagram.addAsset(input, date);
});
