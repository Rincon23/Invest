import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { reminderInputSchema } from '@/lib/server/validation';

export const PUT = apiRoute<{ id: string }>(async ({ request, params, reminders }) => {
  const input = await readJson(request, reminderInputSchema);
  if (input.id !== params.id) throw new HttpError(400, 'INVALID_INPUT', 'Dados inválidos.');
  await reminders.saveReminder(input);
});

export const DELETE = apiRoute<{ id: string }>(async ({ params, reminders }) => {
  await reminders.deleteReminder(params.id);
});
