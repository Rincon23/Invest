// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeWidgetKey, ModuleFlags } from '../../budget/types';
import { ALL_MODULES, resolveHomePages, resolveModules } from '../../modules';
import { syncModules } from '../adminRepository';
import { PostgresBudgetRepository } from '../budgetRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { homeTemplate } from '../homeTemplate';
import { runModulesAlwaysOnMigration } from '../modulesAlwaysOnMigration';

/**
 * Modules stopped being switchable: on the first start everyone but the owner gets the template's
 * Início, once, with every widget showing but the restricted ones (and Missões on top).
 */

let db: Database;

const OWNER = 'dono@capital.test';
const TEMPLATE = 'modelo@capital.local';

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
  vi.stubEnv('OWNER_EMAIL', OWNER);
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function person(
  email: string,
  settings: {
    modules?: Partial<ModuleFlags>;
    homePages?: HomeWidgetKey[][] | null;
    homeHidden?: HomeWidgetKey[];
    homeCardSizes?: Partial<Record<HomeWidgetKey, 'half' | 'full'>>;
  } = {},
) {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Pessoa', email });
  await db.insert(schema.budgetSettings).values({
    userId: id,
    topics: [],
    specialCategories: { fixedCost: 'Custos Fixos', unforeseen: 'Imprevistos' },
    modules: settings.modules ?? {},
    homePages: settings.homePages ?? null,
    homeHidden: settings.homeHidden ?? [],
    homeCardSizes: settings.homeCardSizes ?? {},
  });
  return id;
}

async function settingsOf(userId: string) {
  return new PostgresBudgetRepository(db, userId).getSettings();
}

describe('todos os módulos ligados', () => {
  it('dá a Início do dono para todo mundo, com todos os widgets, uma vez só', async () => {
    const owner = await person(OWNER, {
      modules: { expenses: true, budget: true, card: true, reminders: true },
      homePages: [['budget', 'expenses'], ['card']],
      homeHidden: ['calendar'],
      homeCardSizes: { recurring: 'full' },
    });
    const common = await person('alguem@teste.local', {
      modules: { expenses: true, diagram: true },
      homePages: [['diagram', 'expenses']],
      homeHidden: ['reminders', 'history'],
    });

    expect(await runModulesAlwaysOnMigration(db)).toEqual({ reset: 1 });
    await syncModules(db);

    // The owner's own Início is left as he arranged it.
    const mine = await settingsOf(owner);
    expect(mine.homePages).toEqual([['budget', 'expenses'], ['card']]);
    expect(mine.homeHidden).toEqual(['calendar']);
    expect(resolveModules(mine)).toEqual(ALL_MODULES);

    // Everyone else: the owner's telas and sizes, nothing taken off, Missões on top; the
    // restricted modules (Open Finance) stay out by themselves.
    const theirs = await settingsOf(common);
    expect(theirs.homePages).toEqual([['budget', 'expenses'], ['card']]);
    expect(theirs.homeHidden).toEqual([]);
    expect(theirs.homeCardSizes).toEqual({ recurring: 'full' });
    const pages = resolveHomePages(theirs);
    expect(pages[0].slice(0, 2)).toEqual(['budget', 'expenses']);
    expect(pages.flat()).toContain('reminders');
    expect(pages.flat()).toContain('calendar');
    expect(pages.flat()).not.toContain('banks');

    // Once: what each one changes afterwards stays.
    await db
      .update(schema.budgetSettings)
      .set({ homePages: [['expenses']] })
      .where(eq(schema.budgetSettings.userId, common));
    expect(await runModulesAlwaysOnMigration(db)).toEqual({ reset: 0 });
    expect((await settingsOf(common)).homePages).toEqual([['expenses']]);
  });

  it('com a conta modelo, é a Início dela que vale, e é dela que a conta nova parte', async () => {
    vi.stubEnv('HOME_TEMPLATE_EMAIL', TEMPLATE);
    await person(OWNER, { modules: { expenses: true }, homePages: [['expenses']] });
    await person(TEMPLATE, { homePages: [['reminders'], ['expenses', 'cash']], homeHidden: ['diagram'] });
    const common = await person('alguem@teste.local', { modules: { expenses: true } });

    expect(await runModulesAlwaysOnMigration(db)).toEqual({ reset: 1 });
    expect((await settingsOf(common)).homePages).toEqual([['reminders'], ['expenses', 'cash']]);
    expect((await homeTemplate(db))?.homePages).toEqual([['reminders'], ['expenses', 'cash']]);

    // A brand-new account starts from the template too, with every widget showing.
    const id = randomUUID();
    await db.insert(schema.user).values({ id, name: 'Nova', email: 'nova@teste.local' });
    const fresh = await settingsOf(id);
    expect(fresh.homePages).toEqual([['reminders'], ['expenses', 'cash']]);
    expect(fresh.homeHidden).toEqual([]);
    expect(resolveModules(fresh)).toEqual(ALL_MODULES);
  });

  it('sem dono nem modelo, espera uma próxima subida', async () => {
    vi.stubEnv('OWNER_EMAIL', '');
    await person('alguem@teste.local', { modules: { expenses: true } });
    expect(await runModulesAlwaysOnMigration(db)).toEqual({ reset: 0 });
  });
});
