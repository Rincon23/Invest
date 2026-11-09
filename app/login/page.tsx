import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginScreen } from '@/components/screens/LoginScreen';
import { getAuth } from '@/lib/server/auth';

export const metadata: Metadata = {
  title: 'Entrar — Capital +',
};

// Always rendered per request (it reads the session); never prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read the headers before anything touches the database (see the authenticated layout).
  const requestHeaders = await headers();
  // A valid session (not just a leftover cookie) goes straight to the app.
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) redirect('/');

  const { senha, conta } = await searchParams;
  return <LoginScreen passwordReset={senha === 'redefinida'} accountDeleted={conta === 'excluida'} />;
}
