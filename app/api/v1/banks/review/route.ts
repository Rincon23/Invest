import type { NextRequest } from 'next/server';
import type { BankReview } from '@/lib/banks';
import { requireReviewAccess } from '@/lib/server/banks/access';
import { applyReviewAction, buildReview } from '@/lib/server/banks/review';
import { apiRoute, readJson } from '@/lib/server/http';
import { bankReviewActionSchema, monthKeySchema } from '@/lib/server/validation';

/** The month asked for (`?month=YYYY-MM`; none: this month). */
function monthOf(request: NextRequest): string | undefined {
  const month = request.nextUrl.searchParams.get('month');
  return month ? monthKeySchema.parse(month) : undefined;
}

/** The month's check: what the banks sent in it, beside what is in the Capital. */
export const GET = apiRoute(async ({ request, repo, wallet, banks, access }): Promise<BankReview> => {
  requireReviewAccess(await access());
  return buildReview({ banks, repo, wallet }, { month: monthOf(request) });
});

/** One decision (launch, tie to an existing entry, ignore, bill paid); answers the month again. */
export const POST = apiRoute(async ({ request, repo, wallet, banks, access }): Promise<BankReview> => {
  requireReviewAccess(await access());
  await applyReviewAction({ banks, repo, wallet }, await readJson(request, bankReviewActionSchema));
  return buildReview({ banks, repo, wallet }, { month: monthOf(request) });
});
