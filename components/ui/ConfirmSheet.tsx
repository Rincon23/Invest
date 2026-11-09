'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { BottomSheet } from './BottomSheet';

export interface ConfirmOptions {
  title: string;
  /** What is about to happen, in full sentences — the user decides from this text alone. */
  message: ReactNode;
  /** Defaults to "Confirmar". */
  confirmLabel?: string;
  /** Defaults to "Cancelar". */
  cancelLabel?: string;
  /** Paints the confirm button as destructive. */
  destructive?: boolean;
}

interface ConfirmContextValue {
  /** Asks the user to confirm and resolves to their answer. Replaces `window.confirm`. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * One confirmation sheet for the whole app, in the app's own visual language (a BottomSheet)
 * instead of the browser's `window.confirm`, which on Android looks like a page error.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    setOptions(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(answer);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    // A second request while one is open answers the first with "no" and takes its place.
    resolveRef.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {options && (
        <BottomSheet open title={options.title} onClose={() => settle(false)}>
          <div className="flex flex-col gap-5">
            <div className="text-muted text-sm leading-relaxed">{options.message}</div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => settle(false)}
                className="border-border text-foreground min-h-[44px] flex-1 rounded-lg border px-4 py-2 font-medium"
              >
                {options.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                autoFocus
                className={`min-h-[44px] flex-1 rounded-lg px-4 py-2 font-semibold ${
                  options.destructive
                    ? 'bg-danger text-background'
                    : 'bg-primary text-primary-foreground'
                }`}
              >
                {options.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm deve ser usado dentro de ConfirmProvider');
  return ctx.confirm;
}
