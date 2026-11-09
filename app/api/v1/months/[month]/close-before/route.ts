import { apiRoute } from '@/lib/server/http';
import { closeMonthSchema, monthKeySchema } from '@/lib/server/validation';

/** "Fechar todos os meses anteriores": closes every month before this one still open. */
export const POST = apiRoute<{ month: string }>(async ({ request, params, repo }) => {
  const body: unknown = await request.json().catch(() => ({}));
  const { dropLeftovers } = closeMonthSchema.parse(body ?? {});
  await repo.closeMonthsBefore(monthKeySchema.parse(params.month), dropLeftovers === true);
});
