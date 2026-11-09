import { apiRoute, readJson } from '@/lib/server/http';
import { tagSchema } from '@/lib/server/validation';

/** Creates or changes a tag (name, colour, place); answers with every tag of the account. */
export const PUT = apiRoute(async ({ request, repo }) => {
  const tag = await readJson(request, tagSchema);
  return { tags: await repo.saveTag(tag) };
});
