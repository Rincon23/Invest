import 'server-only';

/**
 * The server's administrator: the account whose e-mail is `OWNER_EMAIL`. It never unlocks a
 * feature (every module is for every user); it only decides who sees server setup details, in
 * the Administração.
 */
export function isOwnerEmail(email: string | null | undefined): boolean {
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || !email) return false;
  return email.trim().toLowerCase() === owner;
}
