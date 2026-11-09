import { apiRoute } from '@/lib/server/http';

/**
 * Everything the Diagrama screen shows: targets, assets with their quotes, questions, answers —
 * and, for a VIP account, the automatic questions (Graham, P/VP) already answered.
 */
export const GET = apiRoute(async ({ diagram, access }) => diagram.getOverview((await access()).vip));
