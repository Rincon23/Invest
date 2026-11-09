import { apiRoute } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

type Params = { month: string; id: string };

/** "Desfazer" of an expense that just went into an earlier month, which may be closed. */
export const POST = apiRoute<Params>(async ({ params, repo }) => {
  await repo.undoLateExpense(monthKeySchema.parse(params.month), params.id);
});
