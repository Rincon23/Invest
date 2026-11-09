import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AdminScreen } from '@/components/screens/AdminScreen';
import { getAuth } from '@/lib/server/auth';
import { isOwnerEmail } from '@/lib/server/owner';

export const metadata: Metadata = { title: 'Administração — Capital +' };

// Always rendered per request (it reads the session); never prerendered at build time.
export const dynamic = 'force-dynamic';

/** Only whoever runs the server (OWNER_EMAIL) gets this screen; for anyone else it does not exist. */
export default async function AdminPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!isOwnerEmail(session?.user.email)) notFound();
  return <AdminScreen />;
}
