import { requireBanksAccess } from '@/lib/server/banks/access';
import { removeConnection } from '@/lib/server/banks/service';
import { apiRoute, readJson } from '@/lib/server/http';
import { bankRenameSchema } from '@/lib/server/validation';

type Params = { itemId: string };

/** The person's own name for a bank (empty goes back to the suggestion). */
export const PATCH = apiRoute<Params>(async ({ request, params, banks, access }) => {
  requireBanksAccess(await access());
  const { name } = await readJson(request, bankRenameSchema);
  await banks.rename(params.itemId, name);
});

/** Takes one bank out of the Capital. */
export const DELETE = apiRoute<Params>(async ({ params, banks, access, userId }) => {
  requireBanksAccess(await access());
  await removeConnection(banks, userId, params.itemId);
});
