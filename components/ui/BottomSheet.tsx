'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { popSheetEntry, pushSheetEntry, registerSheet } from './sheetHistory';
import { UnsavedChanges } from './unsavedChanges';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Extra button(s) next to the close button, e.g. the microphone on the expense form. */
  headerAction?: ReactNode;
  /**
   * Whether leaving with unsaved changes asks first (see `unsavedChanges.ts`). Off where the form
   * is an action rather than an edit — sending a text to the AI, deleting the account —, where
   * "Salvar" would mean something else entirely.
   */
  confirmDiscard?: boolean;
  children: ReactNode;
}

/** How long "Salvar" (from the question) waits for an editor that stays open to finish saving. */
const SAVE_WAIT_MS = 8000;

export function BottomSheet({
  open,
  onClose,
  title,
  headerAction,
  confirmDiscard = true,
  children,
}: BottomSheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [changes] = useState(() => new UnsavedChanges());
  const [asking, setAsking] = useState(false);
  /** Whether the question offers "Salvar" (worked out when it opens: it reads the page). */
  const [saveable, setSaveable] = useState(false);
  const [leavingAfterSave, setLeavingAfterSave] = useState(false);
  const entry = useRef<string | null>(null);

  /** Closing from the sheet itself (X, backdrop, Esc, "Sair sem salvar"): its entry goes too. */
  function close() {
    setAsking(false);
    if (entry.current) popSheetEntry(entry.current);
    onClose();
  }

  function hasChanges() {
    return confirmDiscard && changes.dirtyScopes(panel.current).length > 0;
  }

  function ask() {
    setSaveable(changes.canSave(panel.current));
    setAsking(true);
  }

  function requestClose() {
    if (hasChanges()) ask();
    else close();
  }

  /** The back button already took the entry: close, or — with changes — stay (a fresh entry) and ask. */
  function back() {
    if (hasChanges()) {
      entry.current = pushSheetEntry();
      ask();
    } else {
      setAsking(false);
      onClose();
    }
  }

  // The listeners below live as long as the sheet is open; they always reach the latest render.
  const handlers = useRef({ back, close, requestClose, asking });
  useEffect(() => {
    handlers.current = { back, close, requestClose, asking };
  });

  useEffect(() => {
    if (!open) return;
    entry.current = pushSheetEntry();
    return registerSheet({
      get entry() {
        return entry.current ?? '';
      },
      onBack: () => handlers.current.back(),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (handlers.current.asking) setAsking(false);
      else handlers.current.requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // The "before" picture of each form is taken right before the person first touches it.
  useEffect(() => {
    const element = panel.current;
    if (!open || !element) return;
    const remember = () => changes.remember(element);
    const events = ['pointerdown', 'keydown', 'beforeinput', 'paste'] as const;
    for (const name of events) element.addEventListener(name, remember, { capture: true });
    return () => {
      for (const name of events) element.removeEventListener(name, remember, { capture: true });
    };
  }, [open, changes]);

  // "Salvar" on an editor that stays open after saving: leave once nothing is left unsaved.
  useEffect(() => {
    if (!leavingAfterSave) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const done = changes.dirtyScopes(panel.current).length === 0;
      if (!done && Date.now() - started < SAVE_WAIT_MS) return;
      window.clearInterval(timer);
      setLeavingAfterSave(false);
      if (done) handlers.current.close();
    }, 150);
    return () => window.clearInterval(timer);
  }, [leavingAfterSave, changes]);

  if (!open) return null;

  function saveAndLeave() {
    setAsking(false);
    // A form that saves closes its sheet by itself; an editor with its own button may stay open.
    const waits = changes.dirtyScopes(panel.current).some((scope) => !(scope instanceof HTMLFormElement));
    changes.save(panel.current);
    if (waits) setLeavingAfterSave(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-black/40"
        onClick={requestClose}
      />
      <div
        ref={panel}
        className="bg-card relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-5 shadow-xl sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-foreground text-lg font-semibold">{title}</h2>
          <div className="flex items-center gap-1">
            {headerAction}
            <button
              type="button"
              onClick={requestClose}
              aria-label="Fechar"
              className="text-muted hover:bg-background flex h-10 w-10 items-center justify-center rounded-full"
            >
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" className="h-5 w-5">
                <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        {children}
      </div>

      {asking && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 px-6">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sheet-unsaved-title"
            className="bg-card flex w-full max-w-sm flex-col gap-4 rounded-2xl p-5 shadow-2xl"
          >
            <div className="flex flex-col gap-1">
              <h3 id="sheet-unsaved-title" className="text-foreground text-base font-semibold">
                Salvar as alterações?
              </h3>
              <p className="text-muted text-sm">Você mudou alguma coisa aqui e ainda não salvou.</p>
            </div>
            <div className="flex flex-col gap-2">
              {saveable && (
                <button
                  type="button"
                  onClick={saveAndLeave}
                  className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold"
                >
                  Salvar
                </button>
              )}
              <button
                type="button"
                onClick={close}
                className="border-danger text-danger min-h-[44px] rounded-lg border px-4 text-sm font-semibold"
              >
                Sair sem salvar
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="text-muted hover:text-foreground min-h-[44px] rounded-lg px-4 text-sm font-medium"
              >
                Continuar editando
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
