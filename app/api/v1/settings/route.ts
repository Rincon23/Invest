import { withAccessRules } from '@/lib/modules';
import { apiRoute, readJson } from '@/lib/server/http';
import { settingsSchema } from '@/lib/server/validation';

/** The restricted modules (Administração) read as off for everyone else, whatever is saved (see `withAccessRules`). */
export const GET = apiRoute(async ({ settings, access }) =>
  withAccessRules(await settings.getSettings(), await access()),
);

export const PUT = apiRoute(async ({ request, settings, access }) => {
  const body = await readJson(request, settingsSchema);
  await settings.saveSettings(withAccessRules(body, await access()));
});
