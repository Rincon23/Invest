import { eq } from 'drizzle-orm';
import type { HomeTemplate } from '../modules';
import { budgetSettings, user } from './db/schema';
import type { Database, Transaction } from './db/types';

type Env = Record<string, string | undefined>;

/**
 * The Início template account (`HOME_TEMPLATE_EMAIL` and `HOME_TEMPLATE_PASSWORD` in the
 * environment): how the owner arranges its Início — telas, order, sizes — is the Início every new
 * account starts with, with every widget showing (only a restricted module's stays out, for an
 * account without access). It is an ordinary login, created on its first
 * sign-in like the test account, but never wiped; it sees every module (so every widget can be
 * placed) and stays out of the owner's numbers. Never the owner's nor the test account's address.
 * Unset: nothing, and the owner's own Início is the template.
 */
export function homeTemplateEmail(env: Env = process.env): string | null {
  const email = env.HOME_TEMPLATE_EMAIL?.trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  if (email === env.OWNER_EMAIL?.trim().toLowerCase()) return null;
  if (email === env.TEST_ACCOUNT_EMAIL?.trim().toLowerCase()) return null;
  return email;
}

export function isHomeTemplateEmail(email: string | null | undefined, env: Env = process.env): boolean {
  const template = homeTemplateEmail(env);
  return !!template && !!email && email.trim().toLowerCase() === template;
}

async function layoutOf(ex: Database | Transaction, email: string | null): Promise<HomeTemplate | null> {
  if (!email) return null;
  const [row] = await ex
    .select({
      homePages: budgetSettings.homePages,
      homeOrder: budgetSettings.homeOrder,
      homeCardSizes: budgetSettings.homeCardSizes,
    })
    .from(budgetSettings)
    .innerJoin(user, eq(user.id, budgetSettings.userId))
    .where(eq(user.email, email));
  if (!row) return null;
  return {
    homePages: row.homePages ?? (row.homeOrder ? [row.homeOrder] : null),
    homeCardSizes: row.homeCardSizes,
  };
}

/**
 * The Início template: the template account's, or while there is none yet, the owner's. Null when
 * neither exists (a server without `OWNER_EMAIL`): new accounts get the default order. A widget of
 * a restricted module stays in the copy but only shows for an account with access to it.
 */
export async function homeTemplate(ex: Database | Transaction, env: Env = process.env): Promise<HomeTemplate | null> {
  return (
    (await layoutOf(ex, homeTemplateEmail(env))) ?? (await layoutOf(ex, env.OWNER_EMAIL?.trim().toLowerCase() ?? null))
  );
}
