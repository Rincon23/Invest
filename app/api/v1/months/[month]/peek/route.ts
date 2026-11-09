import { apiRoute } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

/** The month if stored, otherwise a computed preview that is NOT persisted. */
export const GET = apiRoute<{ month: string }>(({ params, repo }) =>
  repo.peekMonth(monthKeySchema.parse(params.month)),
);
