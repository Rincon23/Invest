import { apiRoute } from '@/lib/server/http';

/**
 * Just the registered cards. The Carteira gets them inside its own snapshot; this is for the
 * screens outside it (the expense form's card picker), which have no reason to load the wallet.
 */
export const GET = apiRoute(async ({ wallet }) => ({ cards: await wallet.listCards() }));
