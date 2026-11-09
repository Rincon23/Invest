import { isModuleOn, mayUseModule } from '@/lib/modules';
import { apiRoute, readJson } from '@/lib/server/http';
import { cashSettingsSchema } from '@/lib/server/validation';

export const PUT = apiRoute(async ({ request, repo, wallet, banks, access }) => {
  await wallet.saveCashSettings(await readJson(request, cashSettingsSchema));
  // With the reserve fed by the banks (Open Finance), "Reserva em conta" is theirs, not typed:
  // their sum goes back over whatever came in the form.
  if (mayUseModule(await access(), 'banks') && isModuleOn(await repo.getSettings(), 'banks')) await banks.writeReserve();
});
