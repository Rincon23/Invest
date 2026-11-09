// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleFlags } from '../../budget/types';
import { ALL_MODULES } from '../../modules';
import { requireNotVipLocked, userAccess, vipModules } from '../access';
import { listModules, listUsers, setModuleVip, setVip, syncModules } from '../adminRepository';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { HttpError } from '../httpError';

/**
 * "Restrito" in Administração: the owner picks which modules only accounts with access have. Every
 * other module is on for everyone. Restricted, a module goes off for everyone else (their data
 * stays); opened again, it is on for everyone.
 */

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

const OWNER = 'dono@capital.test';

beforeEach(async () => {
  vi.stubEnv('OWNER_EMAIL', OWNER);
  await db.delete(schema.moduleAccess);
  await db.delete(schema.budgetSettings);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function newPerson(modules: Partial<ModuleFlags>, { vip = false, email }: { vip?: boolean; email?: string } = {}) {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Pessoa', email: email ?? `${id}@teste.local` });
  await db.insert(schema.budgetSettings).values({
    userId: id,
    topics: [],
    specialCategories: { fixedCost: 'Custo Fixo', unforeseen: 'Imprevistos' },
    modules,
  });
  if (vip) await db.insert(schema.vipUsers).values({ userId: id });
  return id;
}

async function modulesOf(userId: string) {
  const [row] = await db
    .select({ modules: schema.budgetSettings.modules })
    .from(schema.budgetSettings)
    .where(eq(schema.budgetSettings.userId, userId));
  return row.modules;
}

describe('módulos só para VIP', () => {
  it('começa como hoje: Open Finance', async () => {
    expect(await vipModules(db)).toEqual(['banks']);
    const id = await newPerson({});
    expect(await userAccess(db, id, `${id}@teste.local`)).toEqual({
      owner: false,
      vip: false,
      vipModules: ['banks'],
    });
  });

  it('ao virar restrito, desliga para quem não tem acesso (e o que depende dele), sem apagar nada', async () => {
    const common = await newPerson({});
    const vip = await newPerson({}, { vip: true });
    const owner = await newPerson({}, { email: OWNER });
    await db.insert(schema.xpEvents).values({ userId: common, mission: 'first-expense', period: 'once', xp: 50 });

    expect(await setModuleVip(db, 'budget', true)).toBe(1);
    expect(await vipModules(db)).toEqual(['budget', 'banks']);
    expect(await modulesOf(common)).toEqual({ ...ALL_MODULES, budget: false, history: false, banks: false });
    expect(await modulesOf(vip)).toEqual(ALL_MODULES);
    expect(await modulesOf(owner)).toEqual(ALL_MODULES);

    // Nothing of theirs goes away with the switch.
    const earned = await db.select().from(schema.xpEvents).where(eq(schema.xpEvents.userId, common));
    expect(earned).toHaveLength(1);

    // And the server refuses it to them from then on, as an address that does not exist.
    expect(() => requireNotVipLocked({ vip: false, vipModules: ['budget'] }, 'budget')).toThrow(HttpError);
    expect(() => requireNotVipLocked({ vip: false, vipModules: ['budget'] }, 'budget')).toThrow('Não encontrado.');
    expect(() => requireNotVipLocked({ vip: true, vipModules: ['budget'] }, 'budget')).not.toThrow();
  });

  it('ao deixar de ser restrito, liga para todo mundo na hora', async () => {
    const common = await newPerson({ banks: false });
    expect(await setModuleVip(db, 'banks', false)).toBe(0);
    expect(await vipModules(db)).toEqual([]);
    expect(await modulesOf(common)).toEqual(ALL_MODULES);
    expect((await userAccess(db, common, `${common}@teste.local`)).vipModules).toEqual([]);

    // Restricted again: off again for whoever has no access.
    expect(await setModuleVip(db, 'banks', true)).toBe(1);
    expect(await modulesOf(common)).toEqual({ ...ALL_MODULES, banks: false });
  });

  it('mostra na Administração cada módulo, a escolha e quem sem acesso usa agora', async () => {
    await newPerson({});
    await newPerson({}, { vip: true });
    await syncModules(db);

    const modules = await listModules(db);
    expect(modules.map((item) => item.key)).toHaveLength(11);
    expect(modules.find((item) => item.key === 'reminders')).toEqual({ key: 'reminders', vipOnly: false, usersWithoutVip: 1 });
    expect(modules.find((item) => item.key === 'banks')).toEqual({ key: 'banks', vipOnly: true, usersWithoutVip: 0 });
    expect(modules.filter((item) => item.vipOnly).map((item) => item.key)).toEqual(['banks']);
  });

  it('quem perde o acesso fica sem os módulos restritos, e os dados ficam; quem ganha, tem na hora', async () => {
    await setModuleVip(db, 'diagram', true);
    const id = await newPerson({}, { vip: true });
    await setVip(db, id, false);
    expect(await modulesOf(id)).toEqual({ ...ALL_MODULES, banks: false, diagram: false });
    expect((await userAccess(db, id, `${id}@teste.local`)).vip).toBe(false);

    await setVip(db, id, true);
    expect(await modulesOf(id)).toEqual(ALL_MODULES);
  });

  it('acerta os módulos de todas as contas ao subir o servidor', async () => {
    const old = await newPerson({ expenses: true, card: false, banks: true });
    expect(await syncModules(db)).toBe(1);
    expect(await modulesOf(old)).toEqual({ ...ALL_MODULES, banks: false });
    expect(await syncModules(db)).toBe(0);
  });

  it('a conta modelo da Início vê todos os módulos e não aparece na Administração', async () => {
    vi.stubEnv('HOME_TEMPLATE_EMAIL', 'modelo@capital.local');
    const template = await newPerson({}, { email: 'modelo@capital.local' });
    expect(await userAccess(db, template, 'modelo@capital.local')).toEqual({
      owner: false,
      vip: true,
      vipModules: ['banks'],
    });
    await syncModules(db);
    expect(await modulesOf(template)).toEqual(ALL_MODULES);
    expect((await listUsers(db)).map((item) => item.email)).not.toContain('modelo@capital.local');
  });
});
