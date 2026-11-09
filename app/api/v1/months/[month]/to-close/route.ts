import { apiRoute } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

/** The months before this one, from the first still open: what the turn of the month offers to close. */
export const GET = apiRoute<{ month: string }>(({ params, repo }) =>
  repo.monthsToClose(monthKeySchema.parse(params.month)),
);
