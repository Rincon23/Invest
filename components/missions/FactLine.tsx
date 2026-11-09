'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import type { InvestingFact } from '@/lib/motivation';

/**
 * The "Você sabia?" of the day, a true fact about investing, inside the Missões bar and card: it
 * comes with the missions, so it never holds anything up. A tap tells where it comes from, on a sheet
 * outside of the bar and of the drawer: inside, the buttons of the Início would float over it.
 */
export function FactLine({ fact, className = '' }: { fact: InvestingFact; className?: string }) {
  const [showing, setShowing] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowing(true)}
        className={`text-muted hover:text-foreground flex w-full items-start gap-2 text-left text-xs leading-snug transition-colors ${className}`}
      >
        <Lightbulb aria-hidden className="text-primary h-4 w-4 shrink-0" />
        <span>{fact.text}</span>
      </button>

      {showing &&
        createPortal(
          <BottomSheet open title="Você sabia?" confirmDiscard={false} onClose={() => setShowing(false)}>
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-foreground font-medium">{fact.text}</p>
              <p className="text-muted">{fact.detail}</p>
              <p className="text-muted text-xs">
                Fonte:{' '}
                {fact.sourceUrl ? (
                  <a
                    href={fact.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary font-medium underline"
                  >
                    {fact.sourceLabel}
                  </a>
                ) : (
                  fact.sourceLabel
                )}
              </p>
            </div>
          </BottomSheet>,
          document.body,
        )}
    </>
  );
}
