import { withAccessRules } from '@/lib/modules';
import { apiRoute, readJson } from '@/lib/server/http';
import { backupSchema } from '@/lib/server/validation';

/** A backup of many years is a few MB; anything past this is not a backup of this app. */
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

/** The account's full backup (the JSON "Exportar dados" downloads), the Diagrama included. */
export const GET = apiRoute(async ({ repo, diagram }) => ({
  ...(await repo.exportData()),
  diagram: await diagram.exportData(),
}));

/** Replaces all of the account's data with the backup (the Diagrama only when the file has it). */
export const POST = apiRoute(async ({ request, repo, diagram, access }) => {
  const backup = await readJson(request, backupSchema, { maxBytes: MAX_BACKUP_BYTES });
  await repo.importData({ ...backup, settings: withAccessRules(backup.settings, await access()) });
  if (backup.diagram) await diagram.importData(backup.diagram);
});
