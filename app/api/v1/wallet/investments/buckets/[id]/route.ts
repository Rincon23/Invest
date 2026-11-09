import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { investmentBucketSchema } from '@/lib/server/validation';

type Params = { id: string };

export const PUT = apiRoute<Params>(async ({ request, params, wallet }) => {
  const bucket = await readJson(request, investmentBucketSchema);
  if (bucket.id !== params.id) {
    throw new HttpError(400, 'INVALID_INPUT', 'O id da categoria da reserva não confere com o endereço.');
  }
  await wallet.saveBucket(bucket);
});

export const DELETE = apiRoute<Params>(async ({ params, wallet }) => {
  await wallet.deleteBucket(params.id);
});
