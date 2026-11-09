/**
 * Runs once when the Next.js server starts: brings the database schema up to date before
 * the first request, applies the one-off data migrations that go with it, then starts the
 * background jobs (reminder notifications and quotes, see lib/server/scheduler.ts) and the automatic
 * tests (lib/server/selfTest). In
 * production a failed migration stops the server (the container restarts and the error shows in
 * its logs) instead of serving requests against an outdated schema.
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

  const [
    { startScheduler },
    { getDb },
    { runCardModuleMigration },
    { runFixedCostLabelMigration },
    { runReserveModuleMigration },
    { runRecurringLaunchLink },
    { runModulesAlwaysOnMigration },
    { runCarryOnCloseMigration },
    { runFixedTopicsMigration },
    { syncModules },
  ] = await Promise.all([
    import('./lib/server/scheduler'),
    import('./lib/server/db'),
    import('./lib/server/cardModuleMigration'),
    import('./lib/server/fixedCostLabelMigration'),
    import('./lib/server/reserveModuleMigration'),
    import('./lib/server/recurringLaunchLink'),
    import('./lib/server/modulesAlwaysOnMigration'),
    import('./lib/server/carryOnCloseMigration'),
    import('./lib/server/fixedTopicsMigration'),
    import('./lib/server/adminRepository'),
  ]);

  // One-off data migrations; each records that it ran and does nothing on the next start.
  try {
    await runCardModuleMigration(getDb());
  } catch (err) {
    console.error('[cartão] falha na migração do módulo único:', err);
  }

  try {
    await runFixedCostLabelMigration(getDb());
  } catch (err) {
    console.error('[categorias] falha ao renomear "Custo Fixo":', err);
  }

  try {
    await runReserveModuleMigration(getDb());
  } catch (err) {
    console.error('[reserva] falha ao juntar as duas reservas:', err);
  }

  try {
    await runRecurringLaunchLink(getDb());
  } catch (err) {
    console.error('[contas do mês] falha ao ligar os gastos já lançados:', err);
  }

  try {
    await runModulesAlwaysOnMigration(getDb());
  } catch (err) {
    console.error('[módulos] falha ao dar a Início padrão a todos:', err);
  }

  try {
    await runCarryOnCloseMigration(getDb());
  } catch (err) {
    console.error('[orçamento] falha ao recalcular a sobra dos meses:', err);
  }

  try {
    await runFixedTopicsMigration(getDb());
  } catch (err) {
    console.error('[categorias] falha ao deixar só as quatro categorias:', err);
  }

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
