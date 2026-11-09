import { apiRoute } from '@/lib/server/http';
import { isoDate, monthKeySchema } from '@/lib/server/validation';

/** Where a new expense dated `?data=YYYY-MM-DD` would go from this month (null: it stays here). */
export const GET = apiRoute<{ month: string }>(async ({ request, params, repo }) => ({
  destination: await repo.lateExpenseDestination(
    monthKeySchema.parse(params.month),
    isoDate.parse(request.nextUrl.searchParams.get('data')),
  ),
}));
