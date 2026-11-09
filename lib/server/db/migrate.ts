import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from './index';

/** Applies every pending SQL migration in /drizzle to DATABASE_URL. Safe to run repeatedly. */
export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: path.join(process.cwd(), 'drizzle') });
}
