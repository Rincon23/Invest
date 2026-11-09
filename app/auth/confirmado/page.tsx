import { redirect } from 'next/navigation';

/**
 * Where the e-mail confirmation link lands after Better Auth has checked it: already signed
 * in on success (autoSignInAfterVerification), or with `?error=…` when the link is invalid
 * or expired.
 */
export default async function EmailConfirmadoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  redirect(error ? '/auth/auth-code-error' : '/');
}
