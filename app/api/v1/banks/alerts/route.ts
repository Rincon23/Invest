import type { BankAlertSettings } from '@/lib/banks';
import { requireBanksAccess } from '@/lib/server/banks/access';
import { apiRoute, readJson } from '@/lib/server/http';
import { bankAlertsSchema } from '@/lib/server/validation';

interface AlertsView {
  settings: BankAlertSettings;
}

/** What the gear of Open Finance shows: what to alert about. */
export const GET = apiRoute(async ({ banks, access }): Promise<AlertsView> => {
  requireBanksAccess(await access());
  return { settings: await banks.alertSettings() };
});

export const PUT = apiRoute(async ({ request, banks, access }): Promise<AlertsView> => {
  requireBanksAccess(await access());
  await banks.saveAlertSettings(await readJson(request, bankAlertsSchema));
  return { settings: await banks.alertSettings() };
});
