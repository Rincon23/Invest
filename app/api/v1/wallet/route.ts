import { apiRoute } from '@/lib/server/http';

/** Everything the Carteira screens need, in one read. */
export const GET = apiRoute(({ wallet }) => wallet.getSnapshot());
