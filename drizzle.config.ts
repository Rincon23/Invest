import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` turns changes in the schema into a new SQL migration under
// /drizzle (no database needed). Migrations are applied on server start.
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
});
