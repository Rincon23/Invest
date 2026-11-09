import { isModuleKey } from '@/lib/modules';
import { setModuleVip } from '@/lib/server/adminRepository';
import { getDb } from '@/lib/server/db';
import { apiRoute, HttpError, readJson } from '@/lib/server/http';
import { moduleVipSchema } from '@/lib/server/validation';

/**
 * Administração: make a module only for VIP accounts ("Só VIP") or open it to everyone. Making it
 * VIP turns it off for the accounts without VIP, keeping all their data.
 */
export const PUT = apiRoute<{ key: string }>(async ({ request, params, access }) => {
  if (!(await access()).owner) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  const { vipOnly } = await readJson(request, moduleVipSchema);
  if (!isModuleKey(params.key)) throw new HttpError(404, 'NOT_FOUND', 'Módulo não encontrado.');
  return { vipOnly, turnedOff: await setModuleVip(getDb(), params.key, vipOnly) };
});
