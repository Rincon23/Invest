import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { clearAccountData } from './accountData';
import { getAuth } from './auth';
import { getDb } from './db';
import { account, user } from './db/schema';

type Env = Record<string, string | undefined>;

/**
 * The first-access test account (`TEST_ACCOUNT_EMAIL` and `TEST_ACCOUNT_PASSWORD` in .env.local):
 * signing in with it creates it when needed (e-mail already confirmed) and wipes its data after
 * every sign-in, so it always opens as a brand-new account — for trying what a new person sees
 * first. Only an address on the reserved `.test` domain (which no real mailbox can have) is taken,
 * and never the owner's, so a slip in the config can never wipe a real account. Unset: nothing.
 */
export function testAccountEmail(env: Env = process.env): string | null {
  const email = env.TEST_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.test$/.test(email)) return null;
  if (email === env.OWNER_EMAIL?.trim().toLowerCase()) return null;
  return email;
}

function samePassword(typed: string, expected: string): boolean {
  const a = Buffer.from(typed);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function findUserId(email: string): Promise<string | null> {
  const [found] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  return found?.id ?? null;
}

/**
 * Before signing in with an account the server's environment configures (the test account, the
 * Início template): creates it, with the e-mail already confirmed, when it does not exist yet and
 * the typed password is the configured one. The sign-in itself still checks the password as for
 * anyone.
 */
export async function ensureConfiguredAccount(
  email: string,
  password: string,
  { expected, name }: { expected: string | undefined; name: string },
): Promise<void> {
  if (!expected || !samePassword(password, expected) || (await findUserId(email))) return;
  const hash = await (await getAuth().$context).password.hash(password);
  await getDb().transaction(async (tx) => {
    const [created] = await tx
      .insert(user)
      .values({ name, email, emailVerified: true })
      .returning({ id: user.id });
    // How Better Auth keeps an e-mail and password login: the account id is the user's own.
    await tx
      .insert(account)
      .values({ userId: created.id, accountId: created.id, providerId: 'credential', password: hash });
  });
}

/** Before signing in with the test account: creates it when needed (see `ensureConfiguredAccount`). */
export function ensureTestAccount(email: string, password: string): Promise<void> {
  return ensureConfiguredAccount(email, password, {
    expected: process.env.TEST_ACCOUNT_PASSWORD,
    name: 'Teste Capital',
  });
}

/** Before signing in with the Início template (lib/server/homeTemplate.ts): creates it when needed. */
export function ensureHomeTemplateAccount(email: string, password: string): Promise<void> {
  return ensureConfiguredAccount(email, password, {
    expected: process.env.HOME_TEMPLATE_PASSWORD,
    name: 'Modelo da Início',
  });
}

/** Right after signing in with the test account: back to a brand-new account, with no data at all. */
export async function resetTestAccount(email: string): Promise<void> {
  const userId = await findUserId(email);
  if (userId) await clearAccountData(getDb(), userId);
}
