import { apiRoute } from '@/lib/server/http';

export const GET = apiRoute(({ repo }) => repo.listMonths());
