import { apiRoute } from '@/lib/server/http';

/** The bell's history: everything the app has notified this account, most recent first. */
export const GET = apiRoute(async ({ notifications }) => notifications.list());

/** "Limpar": takes every notification out of the bell at once. */
export const DELETE = apiRoute(async ({ notifications }) => {
  await notifications.removeAll();
});
