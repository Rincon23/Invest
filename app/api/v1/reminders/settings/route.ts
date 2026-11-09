import { apiRoute, readJson } from '@/lib/server/http';
import { reminderSettingsSchema } from '@/lib/server/validation';

export const PUT = apiRoute(async ({ request, reminders }) => {
  await reminders.saveSettings(await readJson(request, reminderSettingsSchema));
});
