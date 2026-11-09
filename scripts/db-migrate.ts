/**
 * `npm run db:migrate` — applies pending migrations to DATABASE_URL (read from .env.local).
 * The server already does this on start (instrumentation.ts); this is for doing it by hand.
 */
import { loadEnvConfig } from '@next/env';
import { closeDb } from '../lib/server/db';
import { runMigrations } from '../lib/server/db/migrate';

async function main() {
  loadEnvConfig(process.cwd());
  await runMigrations();
  console.log('Migrações aplicadas.');
  await closeDb();
}

main().catch((err) => {
  console.error('Falha ao aplicar as migrações:', err);
  process.exit(1);
});
