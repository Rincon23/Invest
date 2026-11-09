import { apiRoute } from '@/lib/server/http';

export const POST = apiRoute(async ({ notifications }) => {
  await notifications.markAllRead();
});
