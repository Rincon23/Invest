import { z } from 'zod';
import { apiRoute, readJson } from '@/lib/server/http';
import { monthKeySchema, tagSchema } from '@/lib/server/validation';

const id = z.string().min(1).max(100);
const entryRef = z.object({ month: monthKeySchema, id });
/** Far above one account's entries in a month times its months: only a ceiling. */
const MAX_REFS = 50_000;

const bodySchema = z.object({
  tag: tagSchema,
  refs: z.object({
    expenses: z.array(entryRef).max(MAX_REFS),
    incomes: z.array(entryRef).max(MAX_REFS),
    recurring: z.array(id).max(MAX_REFS),
    installments: z.array(id).max(MAX_REFS),
  }),
});

/** "Desfazer" after deleting a tag: it comes back, on the same entries, templates and plans. */
export const POST = apiRoute(async ({ request, repo }) => {
  const { tag, refs } = await readJson(request, bodySchema, { maxBytes: 4 * 1024 * 1024 });
  return { tags: await repo.restoreTag(tag, refs) };
});
