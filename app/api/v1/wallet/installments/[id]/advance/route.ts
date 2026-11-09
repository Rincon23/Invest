import { apiRoute, readJson } from '@/lib/server/http';
import { advanceInstallmentSchema } from '@/lib/server/validation';

type Params = { id: string };

/** "Adiantar parcelas": shortens the plan and writes what was really paid, in one transaction. */
export const POST = apiRoute<Params>(async ({ request, params, wallet }) => {
  await wallet.advanceInstallment(params.id, await readJson(request, advanceInstallmentSchema));
});
