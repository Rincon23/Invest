import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PushSubscriptionSync } from '@/components/pwa/PushSubscriptionSync';
import { AppProviders } from '@/components/providers/AppProviders';
import { LocalDataImportBanner } from '@/components/storage/LocalDataImportBanner';
import { realName } from '@/lib/auth/names';
import { userAccess } from '@/lib/server/access';
import { getAuth } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';

/**
 * Layout for every authenticated route. `proxy.ts` only checks that a session cookie exists;
 * here the session itself is validated, and the user handed to Client Components as
 * `initialUser` (so they render without an auth loading flash).
 */
// Always rendered per request (they depend on the session); never prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Read the headers before anything touches the database: that marks the route dynamic, so
  // `next build` never tries to prerender these screens (and to reach Postgres to do it).
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) redirect('/login');
  const { vip, owner, vipModules } = await userAccess(getDb(), session.user.id, session.user.email);

  return (
    <AppProviders
      initialUser={{
        id: session.user.id,
        email: session.user.email,
        // The placeholder from the e-mail ("enzo.rincon") is not a name: the app waits for a real one.
        name: realName(session.user.name, session.user.email),
        vip,
        vipModules,
        owner,
      }}
    >
      <div className="flex min-h-full flex-1 flex-col">
        <LocalDataImportBanner />
        {children}
      </div>
      <PushSubscriptionSync />
    </AppProviders>
  );
}
