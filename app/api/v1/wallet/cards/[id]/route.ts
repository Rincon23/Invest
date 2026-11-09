import { HttpError, apiRoute, readJson } from '@/lib/server/http';
import { creditCardSchema } from '@/lib/server/validation';

type Params = { id: string };

export const PUT = apiRoute<Params>(async ({ request, params, wallet }) => {
  const card = await readJson(request, creditCardSchema);
  if (card.id !== params.id) {
    throw new HttpError(400, 'INVALID_INPUT', 'O id do cartão não confere com o endereço.');
  }
  await wallet.saveCard(card);
});

/** The purchases of this card stay; they only lose the link (see the schema's foreign key). */
export const DELETE = apiRoute<Params>(async ({ params, wallet }) => {
  await wallet.deleteCard(params.id);
});
