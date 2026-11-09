import { apiRoute } from '@/lib/server/http';

/** Fetches a fresh quote (B3, then Yahoo Finance — free, no token) and caches it. */
export const POST = apiRoute(async ({ wallet }) => {
  await wallet.refreshPrice();
});
