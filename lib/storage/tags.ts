import type { TagRefs } from '../budget/tags';
import type { Month, Tag, TagKind } from '../budget/types';
import { apiRequest, seg } from './apiClient';

/**
 * The tags of expenses and incomes (lib/budget/tags.ts). They have their own operations instead
 * of riding on the settings: deleting one also takes it off every entry, and a save of the
 * settings read a moment earlier must never bring it back.
 */

/** Creates or changes a tag; answers with every tag of the account. */
export async function saveTag(tag: Tag): Promise<Tag[]> {
  return (await apiRequest<{ tags: Tag[] }>('PUT', '/tags', tag)).tags;
}

/** Deletes a tag and takes it off everything; `refs` is where it was, for `restoreTag`. */
export function deleteTag(id: string): Promise<{ tags: Tag[]; refs: TagRefs }> {
  return apiRequest('DELETE', `/tags/${seg(id)}`);
}

/** "Desfazer" after `deleteTag`. */
export async function restoreTag(tag: Tag, refs: TagRefs): Promise<Tag[]> {
  return (await apiRequest<{ tags: Tag[] }>('POST', '/tags/restore', { tag, refs })).tags;
}

/** How many expenses and incomes carry each tag, by id. */
export function tagUsage(): Promise<Record<string, number>> {
  return apiRequest('GET', '/tags/usage');
}

/** The tags of one expense or income, in any month — closed ones included. */
export function setEntryTags(month: Month, kind: TagKind, entryId: string, tagIds: string[]): Promise<void> {
  const path = kind === 'expense' ? 'expenses' : 'incomes';
  return apiRequest('PUT', `/months/${seg(month)}/${path}/${seg(entryId)}/tags`, { tagIds });
}
