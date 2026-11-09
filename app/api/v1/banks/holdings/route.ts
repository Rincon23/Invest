import type { BankHoldings } from '@/lib/banks';
import { isModuleOn } from '@/lib/modules';
import { requireBanksAccess } from '@/lib/server/banks/access';
import { apiRoute } from '@/lib/server/http';

/**
 * The stocks and funds the banks say the person holds, for the Diagrama to compare with its own
 * quantities (the comparison itself is lib/banks/holdings.ts, on the screen). The Reserva
 * investida's quotas come along only while the Reserva module is on.
 */
export const GET = apiRoute(async ({ repo, banks, access }): Promise<BankHoldings> => {
  requireBanksAccess(await access());
  const { banks: sent, holdings } = await banks.holdings();
  const reserve = isModuleOn(await repo.getSettings(), 'cash') ? await banks.investedReserve() : null;
  return { banks: sent, holdings, reserve };
});
