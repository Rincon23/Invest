import { getDb } from '@/lib/server/db';
import { homeTemplate } from '@/lib/server/homeTemplate';
import { apiRoute } from '@/lib/server/http';

/** The Início "Voltar ao padrão" goes back to: the template's (null: the default order). */
export const GET = apiRoute(async () => (await homeTemplate(getDb())) ?? null);
