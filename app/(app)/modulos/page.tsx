'use client';

import { HomeRedirect } from '@/components/layout/HomeRedirect';

/** Módulos no longer exists (every module is always on): old links open the Início. */
export default function ModulosPage() {
  return <HomeRedirect />;
}
