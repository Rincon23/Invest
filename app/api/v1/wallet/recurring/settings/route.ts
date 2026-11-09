import { apiRoute, readJson } from '@/lib/server/http';
import { recurringSettingsSchema } from '@/lib/server/validation';

/** The notices of "Contas do mês": on or off, the time they go out and whether they insist. */
export const PUT = apiRoute(async ({ request, wallet }) => {
  await wallet.saveRecurringSettings(await readJson(request, recurringSettingsSchema));
});
