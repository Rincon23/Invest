import type { BankReviewCounts } from '@/lib/banks';
import { requireReviewAccess } from '@/lib/server/banks/access';
import { reviewCounts } from '@/lib/server/banks/review';
import { apiRoute } from '@/lib/server/http';
import { monthKeySchema } from '@/lib/server/validation';

/**
 * How many lines of a month (`?month=`, none: this one) still ask for a tap, for the bank screen,
 * the Início and each card's bill in the Cartão.
 */
export const GET = apiRoute(async ({ request, repo, wallet, banks, access }): Promise<BankReviewCounts> => {
  requireReviewAccess(await access());
  const month = request.nextUrl.searchParams.get('month');
  return reviewCounts({ banks, repo, wallet }, { month: month ? monthKeySchema.parse(month) : undefined });
});
