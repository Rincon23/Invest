import { apiRoute } from '@/lib/server/http';
import { closeMonthSchema, monthKeySchema } from '@/lib/server/validation';

export const POST = apiRoute<{ month: string }>(async ({ request, params, repo }) => {
  // The body is optional: an older client (or a plain POST) just closes the month.
  const body: unknown = await request.json().catch(() => ({}));
  const { openNext, dropLeftovers } = closeMonthSchema.parse(body ?? {});
  await repo.closeMonth(monthKeySchema.parse(params.month), openNext === true, dropLeftovers === true);
});
