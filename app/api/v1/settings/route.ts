import { withAccessRules } from '@/lib/modules';
import { apiRoute, readJson } from '@/lib/server/http';
import { settingsSchema } from '@/lib/server/validation';

/** The VIP-only modules (Administração) read as off for everyone else, whatever is saved (see `withAccessRules`). */
export const GET = apiRoute(async ({ repo, access }) =>
  withAccessRules(await repo.getSettings(), await access()),
);

export const PUT = apiRoute(async ({ request, repo, access }) => {
  const settings = await readJson(request, settingsSchema);
  await repo.saveSettings(withAccessRules(settings, await access()));
});
