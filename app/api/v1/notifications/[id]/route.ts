import { apiRoute } from '@/lib/server/http';

export const DELETE = apiRoute<{ id: string }>(async ({ params, notifications }) => {
  await notifications.remove(params.id);
});
