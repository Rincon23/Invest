import { z } from 'zod';
import { apiRoute, readJson } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

type Params = { month: string; id: string };

const bodySchema = z.object({ reimbursedAt: z.iso.datetime().nullable() });

/** "Já me pagou" on an "A receber", in any month — closed ones included (see `setReimbursed`). */
export const PUT = apiRoute<Params>(async ({ request, params, repo }) => {
  const { reimbursedAt } = await readJson(request, bodySchema);
  await repo.setReimbursed(monthKeySchema.parse(params.month), params.id, reimbursedAt);
});
