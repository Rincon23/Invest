import 'server-only';
import { eq } from 'drizzle-orm';
import { createDefaultSettings } from '../core/settings';
import type { AppSettings } from '../core/types';
import { settings as settingsTable } from './db/schema';
import type { Database, Transaction } from './db/types';
import { homeTemplate } from './homeTemplate';

type Executor = Database | Transaction;

/** Each account's own settings (the modules, the Início, the notices, the notification switches). */
export class PostgresSettingsRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {}

  /** The settings, created on the first read (with the Início of the template account). */
  async getSettings(): Promise<AppSettings> {
    const existing = await this.readSettings(this.db);
    if (existing) return existing;

    // First read for this account: the Início of the template (lib/server/homeTemplate.ts). Only
    // this first-ever row is created with the welcome still to see.
    const defaults = createDefaultSettings();
    const home = await homeTemplate(this.db);
    await this.db
      .insert(settingsTable)
      .values({
        userId: this.userId,
        onboardingCompleted: defaults.onboardingCompleted ?? false,
        ...(home ? { homePages: home.homePages, homeCardSizes: home.homeCardSizes } : {}),
      })
      .onConflictDoNothing();

    const seeded = await this.readSettings(this.db);
    if (!seeded) throw new Error('Não foi possível inicializar as configurações.');
    return seeded;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.upsert(this.db, settings, false);
  }

  /** Marks this account as having seen the welcome, for good. */
  async completeOnboarding(): Promise<void> {
    await this.db
      .update(settingsTable)
      .set({ onboardingCompleted: true })
      .where(eq(settingsTable.userId, this.userId));
  }

  /** Replaces the settings with the ones of a backup (the welcome flag included). */
  async restore(settings: AppSettings, ex: Executor = this.db): Promise<void> {
    await this.upsert(ex, settings, true);
  }

  async clear(ex: Executor = this.db): Promise<void> {
    await ex.delete(settingsTable).where(eq(settingsTable.userId, this.userId));
  }

  private async readSettings(ex: Executor): Promise<AppSettings | undefined> {
    const [row] = await ex.select().from(settingsTable).where(eq(settingsTable.userId, this.userId));
    if (!row) return undefined;
    return {
      onboardingCompleted: row.onboardingCompleted,
      modules: row.modules,
      dismissedNotices: row.dismissedNotices,
      notificationPrefs: row.notificationPrefs,
      homePages: row.homePages,
      homeCardSizes: row.homeCardSizes,
      homeHidden: row.homeHidden,
    };
  }

  /**
   * Saving settings from the app never touches the welcome flag (only `completeOnboarding` does),
   * and leaves each field alone unless the payload actually carries it — an older client (a cached
   * bundle that predates it) must not wipe it. Restoring a backup replaces all of it.
   */
  private async upsert(ex: Executor, settings: AppSettings, restoring: boolean): Promise<void> {
    const values = {
      ...(restoring || settings.modules !== undefined ? { modules: settings.modules ?? {} } : {}),
      ...(restoring || settings.dismissedNotices !== undefined
        ? { dismissedNotices: settings.dismissedNotices ?? [] }
        : {}),
      ...(restoring || settings.notificationPrefs !== undefined
        ? { notificationPrefs: settings.notificationPrefs ?? {} }
        : {}),
      ...(restoring || settings.homePages !== undefined ? { homePages: settings.homePages ?? null } : {}),
      ...(restoring || settings.homeCardSizes !== undefined
        ? { homeCardSizes: settings.homeCardSizes ?? {} }
        : {}),
      ...(restoring || settings.homeHidden !== undefined ? { homeHidden: settings.homeHidden ?? [] } : {}),
      ...(restoring && settings.onboardingCompleted !== undefined
        ? { onboardingCompleted: settings.onboardingCompleted }
        : {}),
    };
    await ex
      .insert(settingsTable)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: settingsTable.userId, set: { ...values, updatedAt: new Date() } });
  }
}
