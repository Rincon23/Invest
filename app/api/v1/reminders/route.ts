import { apiRoute } from '@/lib/server/http';

export const GET = apiRoute(async ({ reminders }) => reminders.getSnapshot());
