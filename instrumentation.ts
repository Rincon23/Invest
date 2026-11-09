/**
 * Runs once when the Next.js server starts: brings the database schema up to date before the
 * first request, then starts the background jobs (the brokers' daily data, see
 * lib/server/scheduler.ts) and the automatic tests (lib/server/selfTest). In production a failed
 * migration stops the server (the container restarts and the error shows in its logs) instead of
 * serving requests against an outdated schema.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // The board's temperature is watched from the start, even before anyone opens the app.
  const { startLoadGuardMonitor } = await import('./lib/server/loadGuard');
  startLoadGuardMonitor();

  if (!process.env.DATABASE_URL) return;

  const { runMigrations } = await import('./lib/server/db/migrate');
  try {
    await runMigrations();
  } catch (err) {
    console.error('[db] falha ao aplicar as migrações:', err);
    if (process.env.NODE_ENV === 'production') throw err;
  }

  const [{ startScheduler }, { getDb }, { syncModules }] = await Promise.all([
    import('./lib/server/scheduler'),
    import('./lib/server/db'),
    import('./lib/server/adminRepository'),
  ]);

  // Every start: each account's modules as its access says (all, but the restricted ones it may
  // not use), which is what the background jobs read.
  try {
    await syncModules(getDb());
  } catch (err) {
    console.error('[módulos] falha ao acertar os módulos das contas:', err);
  }

  startScheduler(getDb);

  // Every module tested inside the server, a few minutes after the start and then every hour.
  const { startSelfTests } = await import('./lib/server/selfTest/runner');
  startSelfTests(getDb);

  // Traffic spikes, pauses and heat become notifications to the owner (OWNER_EMAIL).
  const { wireLoadGuardAlerts } = await import('./lib/server/alerts');
  wireLoadGuardAlerts(getDb);
}
