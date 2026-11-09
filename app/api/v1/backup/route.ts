import { withAccessRules } from '@/lib/modules';
import { apiRoute, readJson } from '@/lib/server/http';
import { backupSchema } from '@/lib/server/validation';
import { BACKUP_VERSION, type BackupPayload } from '@/lib/storage/repository';

/** A backup of many years is a few MB; anything past this is not a backup of this app. */
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

/** The account's full backup (the JSON "Exportar dados" downloads): settings and the Diagrama. */
export const GET = apiRoute(
  async ({ settings, diagram }): Promise<BackupPayload> => ({
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: await settings.getSettings(),
    diagram: await diagram.exportData(),
  }),
);

/** Replaces all of the account's data with the backup. */
export const POST = apiRoute(async ({ request, settings, diagram, access }) => {
  const backup = await readJson(request, backupSchema, { maxBytes: MAX_BACKUP_BYTES });
  await settings.restore(withAccessRules(backup.settings, await access()));
  await diagram.importData(backup.diagram);
});
