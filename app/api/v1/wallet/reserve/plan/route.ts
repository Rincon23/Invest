import { apiRoute, readJson } from '@/lib/server/http';
import { reservePlanSchema } from '@/lib/server/validation';

/** Cria ou ajusta o plano de recompor a reserva de emergência. */
export const PUT = apiRoute(async ({ request, wallet }) => {
  await wallet.saveReservePlan(await readJson(request, reservePlanSchema));
});

/** Desiste do plano; as parcelas já lançadas continuam nos meses. */
export const DELETE = apiRoute(async ({ wallet }) => {
  await wallet.deleteReservePlan();
});
