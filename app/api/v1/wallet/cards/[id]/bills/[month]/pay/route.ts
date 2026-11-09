import { apiRoute } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

type Params = { id: string; month: string };

/** "Fatura paga": what takes this bill out of the debt. */
export const POST = apiRoute<Params>(async ({ params, wallet }) => {
  await wallet.payBill({ cardId: params.id, month: monthKeySchema.parse(params.month) });
});

/** "Marcar como não paga", when the button was tapped by mistake. */
export const DELETE = apiRoute<Params>(async ({ params, wallet }) => {
  await wallet.unpayBill({ cardId: params.id, month: monthKeySchema.parse(params.month) });
});
