'use client';

import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { signOut as signOutAction } from '@/lib/auth/actions';
import type { ModuleKey } from '@/lib/budget';
import type { ModuleAccess } from '@/lib/modules';
import { UNAUTHENTICATED_EVENT } from '@/lib/storage/httpRepository';

/** Also what `mayUseModule` and `vipLockOf` read (it is a `ModuleAccess`). */
export interface AuthUser extends ModuleAccess {
  id: string;
  email: string | null;
  /** Used for the greeting on the home screen. */
  name: string | null;
  /** May turn on the VIP-only modules (granted by the owner in Administração). */
  vip: boolean;
  /** The modules only VIP accounts can turn on ("Só VIP" in Administração). */
  vipModules: ModuleKey[];
  /** Runs the server (OWNER_EMAIL): sees Administração. */
  owner: boolean;
}

interface AuthContextValue {
  user: AuthUser;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the signed-in user for Client Components. Seeded from the server (`initialUser`,
 * resolved by the authenticated layout) so there is no loading flash. When the API reports
 * the session is gone (expired, or signed out on another device), sends the user to `/login`.
 */
export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: AuthUser;
  children: ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const goToLogin = () => router.replace('/login');
    window.addEventListener(UNAUTHENTICATED_EVENT, goToLogin);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, goToLogin);
  }, [router]);

  const signOut = useCallback(async () => {
    await signOutAction();
  }, []);

  return (
    <AuthContext.Provider value={{ user: initialUser, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
