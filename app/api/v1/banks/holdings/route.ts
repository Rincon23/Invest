import type { BankHoldings } from '@/lib/banks';
import { requireBanksAccess } from '@/lib/server/banks/access';
import { apiRoute } from '@/lib/server/http';

/**
 * The stocks and funds the banks say the person holds, for the Diagrama to compare with its own
 * quantities (the comparison itself is lib/banks/holdings.ts, on the screen), with what the person
 * marked "Fora do Diagrama".
 */
export const GET = apiRoute(async ({ banks, diagram, access }): Promise<BankHoldings> => {
  requireBanksAccess(await access());
  const { banks: sent, holdings } = await banks.holdings();
  return { banks: sent, holdings, outside: await diagram.listOutside() };
});
