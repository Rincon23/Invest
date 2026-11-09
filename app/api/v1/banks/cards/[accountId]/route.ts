import { requireBanksAccess } from '@/lib/server/banks/access';
import { apiRoute, readJson } from '@/lib/server/http';
import { bankCardLinkSchema } from '@/lib/server/validation';

type Params = { accountId: string };

/** Ties a bank card to a Capital card, once (null: "não informado"). */
export const PUT = apiRoute<Params>(async ({ request, params, banks, access }) => {
  requireBanksAccess(await access());
  const { cardId } = await readJson(request, bankCardLinkSchema);
  await banks.linkCard(params.accountId, cardId);
});
