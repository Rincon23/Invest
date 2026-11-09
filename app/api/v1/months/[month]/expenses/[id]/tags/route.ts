import { apiRoute, readJson } from '@/lib/server/http';
import { entryTagsSchema, monthKeySchema } from '@/lib/server/validation';

type Params = { month: string; id: string };

/** The tags of an expense, in any month — closed ones included (see `setEntryTags`). */
export const PUT = apiRoute<Params>(async ({ request, params, repo }) => {
  const { tagIds } = await readJson(request, entryTagsSchema);
  await repo.setEntryTags(monthKeySchema.parse(params.month), 'expense', params.id, tagIds);
});
