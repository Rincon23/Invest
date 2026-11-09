'use client';

import { HomeRedirect } from '@/components/layout/HomeRedirect';

/** Mais is now the app drawer of the Início: old links open the Início with it already up. */
export default function MaisPage() {
  return <HomeRedirect openApps />;
}
