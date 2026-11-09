'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ModuleKey } from '@/lib/budget';
import { isModuleHidden } from '@/lib/modules';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/components/providers/AuthProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useHomeHref } from './useHomeHref';

/**
 * Guards a module's screen. Every module is on for everyone, except a restricted one (or one built
 * on it) for an account without access: for that account the module does not exist, and its
 * address says only that the page was not found, without its name.
 */
export function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { settings, loading } = useSettings();
  const { user } = useAuth();
  const homeHref = useHomeHref();

  if (loading || !settings) {
    return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
  }

  if (!isModuleHidden(user, module)) return <>{children}</>;

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      <PageHeader title="Página não encontrada" backHref={homeHref} />
      <div className="border-border bg-card mx-4 flex flex-col gap-4 rounded-2xl border p-4 shadow-sm">
        <p className="text-muted text-sm">Esta página não existe.</p>
        <Link href={homeHref} className="text-primary text-center text-sm font-semibold">
          Voltar para a Início
        </Link>
      </div>
    </div>
  );
}
