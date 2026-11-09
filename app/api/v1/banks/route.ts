import { MEU_PLUGGY_LIMIT, type BanksOverview } from '@/lib/banks';
import { requireBanksAccess } from '@/lib/server/banks/access';
import { disconnectAll, refreshPending } from '@/lib/server/banks/service';
import { apiRoute } from '@/lib/server/http';
import { allowAttempt } from '@/lib/server/rateLimit';

/**
 * Everything the Open Finance screen shows. Banks still on their way (just authorized) are read
 * from Pluggy first, so coming back from the authorization already shows them arriving.
 */
export const GET = apiRoute(async ({ banks, access, userId }): Promise<BanksOverview & { givenUp: number }> => {
  requireBanksAccess(await access());
  // The screen asks every 5 s while a bank arrives (60 times in 5 minutes); Pluggy is asked at most
  // this often, which leaves room for the Início card and a second open screen.
  const { givenUp } = allowAttempt(`banks-refresh:${userId}`, 120, 5 * 60_000)
    ? await refreshPending(banks, userId)
    : { givenUp: 0 };
  return {
    key: await banks.getKey(),
    connections: await banks.listConnections(),
    limit: MEU_PLUGGY_LIMIT,
    givenUp,
  };
});

/** "Desconectar": the key and every bank leave the Capital (and the person's Pluggy application). */
export const DELETE = apiRoute(async ({ banks, access, userId }) => {
  requireBanksAccess(await access());
  await disconnectAll(banks, userId);
});
