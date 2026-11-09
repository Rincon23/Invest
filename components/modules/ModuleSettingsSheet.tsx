'use client';

import type { ReactNode } from 'react';
import type { ModuleKey } from '@/lib/budget';
import { moduleDefinition } from '@/lib/modules';
import { BottomSheet } from '@/components/ui/BottomSheet';

/** A module's settings, opened by the gear in its screen. The sections inside bring their own padding. */
export function ModuleSettingsSheet({
  module,
  onClose,
  children,
}: {
  module: ModuleKey;
  onClose: () => void;
  children: ReactNode;
}) {
  const info = moduleDefinition(module);
  return (
    <BottomSheet open title={`Configurar ${info.name}`} onClose={onClose}>
      <div className="-mx-4 flex flex-col gap-6">{children}</div>
    </BottomSheet>
  );
}
