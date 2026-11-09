/**
 * The person's name, as the account keeps it: one `name` with "Nome Sobrenome". Accounts made
 * before the sign-up asked for it got the start of the e-mail address instead ("enzo.rincon"),
 * which is not a name anybody should be called by — those count as having no name until the
 * person writes one in Configurações.
 */

/** Longest first name and last name the forms take. */
export const MAX_NAME_PART = 60;

/** Whether `name` is something the person chose, not the placeholder taken from the e-mail. */
export function hasRealName(name: string | null | undefined, email: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return false;
  const local = email?.split('@')[0]?.trim().toLowerCase();
  return !local || trimmed.toLowerCase() !== local;
}

/** The name to show, or null when the account has none of its own yet. */
export function realName(name: string | null | undefined, email: string | null | undefined): string | null {
  return hasRealName(name, email) ? name!.trim().replace(/\s+/g, ' ') : null;
}

/** How the app calls the person: the first name only ("Enzo"), or null without one. */
export function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

/** "Enzo Rincon" → { first: "Enzo", last: "Rincon" }; everything after the first word is the surname. */
export function splitName(name: string | null | undefined): { first: string; last: string } {
  const [first = '', ...rest] = name?.trim().split(/\s+/) ?? [];
  return { first, last: rest.join(' ') };
}

/** Joins what the form got, tidied up; null when the first name is missing or too long. */
export function joinName(first: string, last: string): string | null {
  const cleanFirst = first.trim().replace(/\s+/g, ' ');
  const cleanLast = last.trim().replace(/\s+/g, ' ');
  if (!cleanFirst || cleanFirst.length > MAX_NAME_PART || cleanLast.length > MAX_NAME_PART) return null;
  return cleanLast ? `${cleanFirst} ${cleanLast}` : cleanFirst;
}
