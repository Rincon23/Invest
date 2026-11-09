import { apiRoute, readJson } from '@/lib/server/http';
import { diagramStopBuyingSchema } from '@/lib/server/validation';

/** "Não compro mais", from the list or the asset sheet. */
export const PUT = apiRoute<{ id: string }>(async ({ request, params, diagram }) => {
  const { stopBuying } = await readJson(request, diagramStopBuyingSchema);
  await diagram.setStopBuying(params.id, stopBuying);
});
