import { apiRoute } from '@/lib/server/http';

export const POST = apiRoute<{ id: string }>(async ({ params, notifications }) => {
  await notifications.markRead(params.id);
});
