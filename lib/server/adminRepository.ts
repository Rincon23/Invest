import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AdminModule, AdminUser } from '../admin/types';
import type { ModuleKey } from '../budget/types';
import { effectiveModules, MODULE_KEYS, resolveModules } from '../modules';
import { vipModules } from './access';
import { budgetSettings, moduleAccess, session, user, vipUsers } from './db/schema';
import type { Database } from './db/types';
import { isHomeTemplateEmail } from './homeTemplate';
import { isOwnerEmail } from './owner';

/** Every account on the server, newest first, for Administração (owner only). */
export async function listUsers(db: Database): Promise<AdminUser[]> {
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      emailVerified: user.emailVerified,
      vip: sql<boolean>`${vipUsers.userId} is not null`,
      lastSeenAt: sql<
        string | null
      >`(select max(${session.updatedAt}) from ${session} where ${session.userId} = ${user.id})`,
    })
    .from(user)
    .leftJoin(vipUsers, eq(vipUsers.userId, user.id))
    .orderBy(desc(user.createdAt))
    .limit(2000);

  // The Início template account is a tool of the owner's, not a person: it is left out.
  return rows.filter((row) => !isHomeTemplateEmail(row.email)).map((row) => {
    const owner = isOwnerEmail(row.email);
    return {
      id: row.id,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
      emailVerified: row.emailVerified,
      vip: owner || row.vip,
      owner,
      lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
    };
  });
}

/** Gives an account access to the restricted modules or takes it back. False when there is no such account. */
export async function setVip(db: Database, userId: string, vip: boolean): Promise<boolean> {
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (!target) return false;
  if (vip) await db.insert(vipUsers).values({ userId }).onConflictDoNothing();
  else await db.delete(vipUsers).where(eq(vipUsers.userId, userId));
  // The restricted modules come or go for the account at once (its data stays either way).
  await syncModules(db, { userId });
  return true;
}

/** Every module, in catalog order, with the owner's "Restrito" choice and who would lose it. */
export async function listModules(db: Database): Promise<AdminModule[]> {
  const [vipOnly, accounts] = await Promise.all([vipModules(db), accountsWithoutVip(db)]);
  const resolved = accounts.map((account) => resolveModules(account.modules));
  return MODULE_KEYS.map((key) => ({
    key,
    vipOnly: vipOnly.includes(key),
    usersWithoutVip: resolved.filter((modules) => modules[key]).length,
  }));
}

/**
 * Makes a module restricted ("Restrito") or opens it to everyone. Restricted, it goes off for every
 * account without access, together with the modules built on it; opened, it is on for everyone
 * again. Returns how many accounts lost it.
 */
export async function setModuleVip(db: Database, key: ModuleKey, vipOnly: boolean): Promise<number> {
  await db
    .insert(moduleAccess)
    .values({ moduleKey: key, vipOnly })
    .onConflictDoUpdate({ target: moduleAccess.moduleKey, set: { vipOnly, updatedAt: new Date() } });
  return syncModules(db, { lost: key });
}

/** The module switches of every account without access to the restricted modules. */
async function accountsWithoutVip(db: Database, userId?: string) {
  const rows = await db
    .select({ userId: budgetSettings.userId, modules: budgetSettings.modules, email: user.email })
    .from(budgetSettings)
    .innerJoin(user, eq(user.id, budgetSettings.userId))
    .leftJoin(vipUsers, eq(vipUsers.userId, budgetSettings.userId))
    .where(and(isNull(vipUsers.userId), userId ? eq(budgetSettings.userId, userId) : undefined));
  return rows.filter((row) => !isOwnerEmail(row.email) && !isHomeTemplateEmail(row.email));
}

/**
 * Saves in each account's settings the modules it has: all of them, but the restricted ones it may
 * not use (`effectiveModules`) — what the background jobs read. Runs on every start of the server
 * and whenever access changes; only the switches change, never any data (cards, banks, keys all
 * stay, waiting for the module to come back). With `lost`, returns how many accounts had that
 * module and lost it; otherwise, how many accounts changed.
 */
export async function syncModules(
  db: Database,
  { userId, lost }: { userId?: string; lost?: ModuleKey } = {},
): Promise<number> {
  const restricted = await vipModules(db);
  const rows = await db
    .select({
      userId: budgetSettings.userId,
      modules: budgetSettings.modules,
      email: user.email,
      vip: sql<boolean>`${vipUsers.userId} is not null`,
    })
    .from(budgetSettings)
    .innerJoin(user, eq(user.id, budgetSettings.userId))
    .leftJoin(vipUsers, eq(vipUsers.userId, budgetSettings.userId))
    .where(userId ? eq(budgetSettings.userId, userId) : undefined);

  let count = 0;
  for (const row of rows) {
    const vip = row.vip || isOwnerEmail(row.email) || isHomeTemplateEmail(row.email);
    const modules = effectiveModules({ vip, vipModules: restricted });
    if (MODULE_KEYS.every((key) => row.modules[key] === modules[key])) continue;
    const had = resolveModules(row.modules);
    await db.update(budgetSettings).set({ modules }).where(eq(budgetSettings.userId, row.userId));
    if (lost ? had[lost] && !modules[lost] : true) count += 1;
  }
  return count;
}
