import { apiRoute } from '@/lib/server/http';

type Params = { ticker: string };

/** The ticker goes back to being checked in full against the banks. */
export const DELETE = apiRoute<Params>(async ({ params, diagram }) => {
  await diagram.removeOutside(params.ticker);
});
