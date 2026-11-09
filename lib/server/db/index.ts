import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type AppDatabase = NodePgDatabase<typeof schema>;

// One pool per server process, kept on globalThis so dev hot reloads don't open new pools.
const globalForDb = globalThis as unknown as { capitalDb?: AppDatabase; capitalPool?: Pool };

/** The app's database (DATABASE_URL). Created on first use, so importing this never needs the env. */
export function getDb(): AppDatabase {
  if (!globalForDb.capitalDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL não está configurada.');
    const pool = new Pool({ connectionString, max: 10 });
    // An idle connection dropping (e.g. Postgres restarting) must not crash the server.
    pool.on('error', (err) => console.error('[db] conexão ociosa com erro:', err.message));
    globalForDb.capitalPool = pool;
    globalForDb.capitalDb = drizzle({ client: pool, schema });
  }
  return globalForDb.capitalDb;
}

/** Closes the connection pool. Scripts only: the server keeps it for its whole life. */
export async function closeDb(): Promise<void> {
  const pool = globalForDb.capitalPool;
  globalForDb.capitalDb = undefined;
  globalForDb.capitalPool = undefined;
  await pool?.end();
}
