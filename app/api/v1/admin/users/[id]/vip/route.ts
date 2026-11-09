import { z } from 'zod';
import { setVip } from '@/lib/server/adminRepository';
import { getDb } from '@/lib/server/db';
import { apiRoute, HttpError, readJson } from '@/lib/server/http';
import { vipSchema } from '@/lib/server/validation';

/** Administração: make an account VIP (it may turn on the VIP-only modules) or take it back. */
export const PUT = apiRoute<{ id: string }>(async ({ request, params, access, userId }) => {
  if (!(await access()).owner) throw new HttpError(404, 'NOT_FOUND', 'Não encontrado.');
  const { vip } = await readJson(request, vipSchema);
  if (!z.uuid().safeParse(params.id).success) throw new HttpError(404, 'NOT_FOUND', 'Conta não encontrada.');
  if (params.id === userId) {
    throw new HttpError(400, 'OWNER_ALWAYS_VIP', 'A sua conta de administrador é sempre VIP.');
  }
  if (!(await setVip(getDb(), params.id, vip))) {
    throw new HttpError(404, 'NOT_FOUND', 'Conta não encontrada.');
  }
  return { vip };
});
