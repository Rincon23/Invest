'use client';

import { CircleHelp, Settings } from 'lucide-react';
import type { ModuleKey } from '@/lib/budget';
import { helpAnchor, moduleDefinition } from '@/lib/modules';
import { useTour } from './tour/TourProvider';

const ICON_BUTTON =
  'text-muted hover:text-foreground hover:bg-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors';

/**
 * "Como funciona?": replays the module's tour, the spotlight that walks through its screen. Every
 * module has one — in its screen's header, or where a module without a screen shows up.
 */
export function ModuleHelpButton({
  module,
  variant = 'icon',
  label,
  onBeforeTour,
}: {
  module: ModuleKey;
  variant?: 'icon' | 'link';
  /** Replaces "Como funciona?" in the link variant. */
  label?: string;
  /** Runs first, e.g. to close the sheet the button is in. */
  onBeforeTour?: () => void;
}) {
  const { startTour } = useTour();
  const name = moduleDefinition(module).name;

  function handleClick() {
    onBeforeTour?.();
    startTour([module]);
  }

  if (variant === 'link') {
    return (
      <button
        type="button"
        onClick={handleClick}
        data-tour={helpAnchor(module)}
        className="text-primary inline-flex min-h-[40px] items-center gap-1.5 rounded-full text-sm font-semibold"
      >
        <CircleHelp aria-hidden className="h-4 w-4" />
        {label ?? 'Como funciona?'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-tour={helpAnchor(module)}
      aria-label={`Como funciona: ${name}`}
      title="Como funciona?"
      className={ICON_BUTTON}
    >
      <CircleHelp aria-hidden className="h-5 w-5" />
    </button>
  );
}

/** The gear in a module's header: that module's own settings. */
export function ModuleSettingsButton({
  module,
  onClick,
  tourAnchor,
}: {
  module: ModuleKey;
  onClick: () => void;
  tourAnchor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={tourAnchor}
      aria-label={`Configurações: ${moduleDefinition(module).name}`}
      title="Configurações"
      className={ICON_BUTTON}
    >
      <Settings aria-hidden className="h-5 w-5" />
    </button>
  );
}
