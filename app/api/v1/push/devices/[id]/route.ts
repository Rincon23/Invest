import { z } from 'zod';
import { apiRoute } from '@/lib/server/http';

export const DELETE = apiRoute<{ id: string }>(async ({ params, push }) => {
  // Device ids are UUIDs; anything else cannot exist, so there is nothing to delete.
  if (z.uuid().safeParse(params.id).success) await push.removeDevice(params.id);
});
