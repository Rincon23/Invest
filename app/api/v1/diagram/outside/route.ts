import { apiRoute, readJson } from '@/lib/server/http';
import { diagramOutsideSchema } from '@/lib/server/validation';

/** "Fora do Diagrama": what the banks hold of a ticker and is not the Diagrama's. */
export const PUT = apiRoute(async ({ request, diagram }) => {
  const { ticker, quantity } = await readJson(request, diagramOutsideSchema);
  await diagram.setOutside(ticker, quantity);
});
