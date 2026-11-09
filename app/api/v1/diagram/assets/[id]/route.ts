import { apiRoute, readJson } from '@/lib/server/http';
import { diagramAssetSchema } from '@/lib/server/validation';

export const PUT = apiRoute<{ id: string }>(async ({ request, params, diagram }) => {
  const { date, ...input } = await readJson(request, diagramAssetSchema);
  await diagram.updateAsset(params.id, input, date);
});

/** Removes the asset and its answers (the screen asks first). */
export const DELETE = apiRoute<{ id: string }>(async ({ params, diagram }) => {
  await diagram.deleteAsset(params.id);
});
