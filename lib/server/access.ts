import 'server-only';
import { eq } from 'drizzle-orm';
import type { ModuleKey } from '../budget/types';
import { mayUseModule, vipModulesFrom, type ModuleAccess } from '../modules';
import { moduleAccess, vipUsers } from './db/schema';
import type { Database } from './db/types';
import { isHomeTemplateEmail } from './homeTemplate';
import { HttpError } from './httpError';
import { isOwnerEmail } from './owner';

/** What an account may do beyond the ordinary: run the server (owner) and use the restricted modules. */
export interface UserAccess extends ModuleAccess {
  /** The account whose e-mail is OWNER_EMAIL: sees Administração and is always VIP. */
  owner: boolean;
  /** Has the restricted modules (`vipModules`). */
  vip: boolean;
}

/** The restricted modules, as the owner set them in Administração. */
export async function vipModules(db: Database): Promise<ModuleKey[]> {
  const rows = await db
    .select({ moduleKey: moduleAccess.moduleKey, vipOnly: moduleAccess.vipOnly })
    .from(moduleAccess);
  return vipModulesFrom(Object.fromEntries(rows.map((row) => [row.moduleKey, row.vipOnly])));
}

export async function userAccess(db: Database, userId: string, email: string | null): Promise<UserAccess> {
  const modules = vipModules(db);
  if (isOwnerEmail(email)) return { owner: true, vip: true, vipModules: await modules };
  // The Início template sees every module, so every widget can be placed on it.
  if (isHomeTemplateEmail(email)) return { owner: false, vip: true, vipModules: await modules };
  const [[row], list] = await Promise.all([
    db.select({ userId: vipUsers.userId }).from(vipUsers).where(eq(vipUsers.userId, userId)),
    modules,
  ]);
  return { owner: false, vip: row !== undefined, vipModules: list };
}

/**
 * Refuses a restricted module ("Restrito" in Administração) to an account without access. Like
 * Administração for anyone but the owner, its addresses simply do not exist (404), with no name:
 * nobody without access learns the module is there.
 */
export function requireNotVipLocked(access: ModuleAccess, key: ModuleKey): void {
  if (!mayUseModule(access, key)) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
}
