import { apiRoute } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

/** Every "A receber" still not paid back, from `?ate=YYYY-MM` and the months before it. */
export const GET = apiRoute(async ({ request, repo }) =>
  repo.pendingReimbursables(monthKeySchema.parse(request.nextUrl.searchParams.get('ate'))),
);
