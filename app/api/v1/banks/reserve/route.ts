import type { BankReserve } from '@/lib/banks';
import { requireBanksAccess } from '@/lib/server/banks/access';
import { apiRoute, readJson } from '@/lib/server/http';
import { bankReserveSchema } from '@/lib/server/validation';

/** What can feed the Reserva (accounts and investments, bank by bank) and what is marked. */
export const GET = apiRoute(async ({ banks, access }): Promise<BankReserve> => {
  requireBanksAccess(await access());
  return banks.reserve();
});

/**
 * Marks what feeds the Reserva and writes its sum as "Reserva em conta" right away. Nothing marked
 * goes back to typing it (the value stays as it was).
 */
export const PUT = apiRoute(async ({ request, banks, access }): Promise<BankReserve> => {
  requireBanksAccess(await access());
  const { accounts, investments } = await readJson(request, bankReserveSchema);
  await banks.setReserveSources(accounts, investments);
  await banks.writeReserve();
  return banks.reserve();
});
