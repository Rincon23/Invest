import { apiRoute, readJson } from '@/lib/server/http';
import { reserveContributionSchema } from '@/lib/server/validation';

/** Lança uma parcela do plano: o gasto do mês e o dinheiro entrando na reserva, numa transação. */
export const POST = apiRoute(async ({ request, wallet }) => {
  await wallet.contributeToReserve(await readJson(request, reserveContributionSchema));
});
