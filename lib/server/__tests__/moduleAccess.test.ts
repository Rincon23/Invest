// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleFlags } from '../../core/types';
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

const OWNER = 'dono@invest.test';

beforeEach(async () => {
  vi.stubEnv('OWNER_EMAIL', OWNER);
  await db.delete(schema.moduleAccess);
  await db.delete(schema.settings);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function newPerson(modules: Partial<ModuleFlags>, { vip = false, email }: { vip?: boolean; email?: string } = {}) {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Pessoa', email: email ?? `${id}@teste.local` });
  await db.insert(schema.settings).values({ userId: id, modules });
  if (vip) await db.insert(schema.vipUsers).values({ userId: id });
  return id;
}

async function modulesOf(userId: string) {
  const [row] = await db
    .select({ modules: schema.settings.modules })
    .from(schema.settings)
    .where(eq(schema.settings.userId, userId));
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
    await db.insert(schema.diagramSettings).values({ userId: common, targets: { brStocks: 1 } });

    expect(await setModuleVip(db, 'diagram', true)).toBe(1);
    expect(await vipModules(db)).toEqual(['diagram', 'banks']);
    expect(await modulesOf(common)).toEqual({ ...ALL_MODULES, diagram: false, history: false, banks: false });
    expect(await modulesOf(vip)).toEqual(ALL_MODULES);
    expect(await modulesOf(owner)).toEqual(ALL_MODULES);

    // Nothing of theirs goes away with the switch.
    const kept = await db.select().from(schema.diagramSettings).where(eq(schema.diagramSettings.userId, common));
    expect(kept).toHaveLength(1);

    // And the server refuses it to them from then on, as an address that does not exist.
    expect(() => requireNotVipLocked({ vip: false, vipModules: ['diagram'] }, 'diagram')).toThrow(HttpError);
    expect(() => requireNotVipLocked({ vip: false, vipModules: ['diagram'] }, 'diagram')).toThrow('Não encontrado.');
    expect(() => requireNotVipLocked({ vip: true, vipModules: ['diagram'] }, 'diagram')).not.toThrow();
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
    expect(modules.map((item) => item.key)).toEqual(['diagram', 'history', 'banks']);
    expect(modules.find((item) => item.key === 'history')).toEqual({ key: 'history', vipOnly: false, usersWithoutVip: 1 });
    expect(modules.find((item) => item.key === 'banks')).toEqual({ key: 'banks', vipOnly: true, usersWithoutVip: 0 });
    expect(modules.filter((item) => item.vipOnly).map((item) => item.key)).toEqual(['banks']);
  });

  it('quem perde o acesso fica sem os módulos restritos, e os dados ficam; quem ganha, tem na hora', async () => {
    await setModuleVip(db, 'history', true);
    const id = await newPerson({}, { vip: true });
    await setVip(db, id, false);
    expect(await modulesOf(id)).toEqual({ ...ALL_MODULES, banks: false, history: false });
    expect((await userAccess(db, id, `${id}@teste.local`)).vip).toBe(false);

    await setVip(db, id, true);
    expect(await modulesOf(id)).toEqual(ALL_MODULES);
  });

  it('acerta os módulos de todas as contas ao subir o servidor', async () => {
    const old = await newPerson({ diagram: true, history: false, banks: true });
    expect(await syncModules(db)).toBe(1);
    expect(await modulesOf(old)).toEqual({ ...ALL_MODULES, banks: false });
    expect(await syncModules(db)).toBe(0);
  });

  it('a conta modelo da Início vê todos os módulos e não aparece na Administração', async () => {
    vi.stubEnv('HOME_TEMPLATE_EMAIL', 'modelo@invest.local');
    const template = await newPerson({}, { email: 'modelo@invest.local' });
    expect(await userAccess(db, template, 'modelo@invest.local')).toEqual({
      owner: false,
      vip: true,
      vipModules: ['banks'],
    });
    await syncModules(db);
    expect(await modulesOf(template)).toEqual(ALL_MODULES);
    expect((await listUsers(db)).map((item) => item.email)).not.toContain('modelo@invest.local');
  });
});
