import { apiRoute, readJson } from '@/lib/server/http';
import { reminderDoneSchema } from '@/lib/server/validation';

export const POST = apiRoute<{ id: string }>(async ({ request, params, reminders }) => {
  const { dueDate, done } = await readJson(request, reminderDoneSchema);
  await reminders.setDone(params.id, dueDate, done);
});
