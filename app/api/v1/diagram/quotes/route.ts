import { apiRoute } from '@/lib/server/http';

/** "Atualizar cotações": every asset of the account, from the free sources, now (and, VIP, LPA/VPA/P/VP). */
export const POST = apiRoute(async ({ diagram, access }) => diagram.refreshQuotes((await access()).vip));
