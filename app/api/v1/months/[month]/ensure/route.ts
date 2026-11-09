import { apiRoute } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

/** The month, creating and persisting it (with rollover carryIn) if it doesn't exist yet. */
export const POST = apiRoute<{ month: string }>(({ params, repo }) =>
  repo.ensureMonth(monthKeySchema.parse(params.month)),
);
