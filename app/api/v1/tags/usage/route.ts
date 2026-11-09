import { apiRoute } from '@/lib/server/http';

/** How many expenses and incomes carry each tag, by tag id. */
export const GET = apiRoute(async ({ repo }) => repo.tagUsage());
