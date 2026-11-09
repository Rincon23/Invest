'use client';

import type { ReactNode } from 'react';

interface OnboardingScreenProps {
  step: number;
  totalSteps: number;
  onSkip: () => void;
  children: ReactNode;
  footer: ReactNode;
}

/** Full-screen shell of the setup wizard: progress dots, a persistent "Pular", scrollable content, and a footer for nav buttons. */
export function OnboardingScreen({ step, totalSteps, onSkip, children, footer }: OnboardingScreenProps) {
  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true">
      <div
        className="flex items-center justify-between gap-3 px-5"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
      >
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: totalSteps }).map((_, index) => (
            <span
              key={index}
              className={`h-1.5 w-6 rounded-full transition-colors ${
                index < step ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-muted hover:text-foreground min-h-[44px] shrink-0 px-2 text-sm font-medium"
        >
          Pular
        </button>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">{children}</div>

      <div
        className="border-border flex gap-3 border-t px-5 py-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        {footer}
      </div>
    </div>
  );
}
