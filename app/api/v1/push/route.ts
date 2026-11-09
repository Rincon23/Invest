import { apiRoute } from '@/lib/server/http';
import { pushPublicKey } from '@/lib/server/push';

/** What the Notificações section needs: the key to subscribe with and this user's devices. */
export const GET = apiRoute(async ({ push }) => ({
  publicKey: pushPublicKey(),
  devices: await push.listDevices(),
}));
