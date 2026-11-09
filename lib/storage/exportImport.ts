import type { BackupPayload } from './repository';

/** Triggers a browser download of the backup payload as a formatted JSON file. */
export function downloadBackup(payload: BackupPayload): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `capital-backup-${payload.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export class InvalidBackupFileError extends Error {
  constructor() {
    super('Arquivo inválido. Selecione um backup JSON exportado pelo Capital +.');
    this.name = 'InvalidBackupFileError';
  }
}

function isBackupPayload(value: unknown): value is BackupPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    [1, 2, 3, 4].includes(candidate.version as number) &&
    typeof candidate.exportedAt === 'string' &&
    typeof candidate.settings === 'object' &&
    Array.isArray(candidate.months)
  );
}

/** Reads and validates a backup JSON file selected by the user. */
export async function readBackupFile(file: File): Promise<BackupPayload> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidBackupFileError();
  }
  if (!isBackupPayload(parsed)) throw new InvalidBackupFileError();
  return parsed;
}
