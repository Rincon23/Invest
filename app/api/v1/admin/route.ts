import type { AdminOverview } from '@/lib/admin/types';
import { listModules, listUsers } from '@/lib/server/adminRepository';
import { getDb } from '@/lib/server/db';
import { apiRoute, HttpError } from '@/lib/server/http';
import { loadGuardSnapshot } from '@/lib/server/loadGuard';
import { selfTestOverview } from '@/lib/server/selfTest/runner';

/**
 * Administração: how the server is doing, the automatic tests, every account with its VIP status and
 * every module with its "Só VIP" choice. Only for the owner (OWNER_EMAIL); for anyone else this address does not exist.
 */
export const GET = apiRoute(async ({ access }): Promise<AdminOverview> => {
  if (!(await access()).owner) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  const db = getDb();
  const [users, modules, tests] = await Promise.all([listUsers(db), listModules(db), selfTestOverview(db)]);
  return { status: loadGuardSnapshot(), users, modules, tests };
});
