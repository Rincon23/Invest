import { clearAccountData } from '@/lib/server/accountData';
import { getDb } from '@/lib/server/db';
import { apiRoute } from '@/lib/server/http';

/** "Apagar todos os dados": everything the signed-in account stored, in every module. */
export const DELETE = apiRoute(async ({ userId }) => {
  await clearAccountData(getDb(), userId);
});
