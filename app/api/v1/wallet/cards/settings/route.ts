import { apiRoute, readJson } from '@/lib/server/http';
import { cardSettingsSchema } from '@/lib/server/validation';

/** The bill notices: the time they go out at and whether they insist until the bill is paid. */
export const PUT = apiRoute(async ({ request, wallet }) => {
  await wallet.saveCardSettings(await readJson(request, cardSettingsSchema));
});
