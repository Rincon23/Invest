import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** Any Drizzle Postgres database with the Capital schema: node-postgres in the app, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** An open transaction on a `Database`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
