import { apiRoute } from '@/lib/server/http';

type Params = { id: string };

/**
 * Deletes a tag and takes it off every entry, template and plan. Answers with the tags left and
 * where it was (`refs`), for "Desfazer".
 */
export const DELETE = apiRoute<Params>(async ({ params, repo }) => repo.deleteTag(params.id));
