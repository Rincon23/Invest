import { MonthNotFoundError } from '@/lib/storage/repository';
import { apiRoute } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

type Params = { month: string };

/** A stored month, or 404 MONTH_NOT_FOUND (the client reads that as "not created yet"). */
export const GET = apiRoute<Params>(async ({ params, repo }) => {
  const month = monthKeySchema.parse(params.month);
  const data = await repo.getMonth(month);
  if (!data) throw new MonthNotFoundError(month);
  return data;
});

export const DELETE = apiRoute<Params>(async ({ params, repo }) => {
  await repo.deleteMonth(monthKeySchema.parse(params.month));
});
