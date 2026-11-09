'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createId } from '@/lib/budget';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  /**
   * Shows a short message at the bottom of the screen. Replaces the bot's ✅ / ↩️ / ⚠️ replies.
   * An `action` (e.g. "Desfazer") adds a button and keeps the message up a little longer.
   * Only one message is up at a time: a new one takes the place of the one on screen.
   */
  showToast: (message: string, kind?: ToastKind, options?: { action?: ToastAction }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VISIBLE_MS = 3200;
const WITH_ACTION_MS = 6000;

/** A sideways drag shorter than this (px) is still a tap, so the "Desfazer" button keeps working. */
const DRAG_SLOP = 8;
/** Releasing past this share of the balloon's width throws it away, like a phone notification. */
const DISMISS_SHARE = 0.35;
/** …or a quick flick (px per ms) that has already gone a little way. */
const FLING_SPEED = 0.5;
const FLING_MIN = 32;
const SLIDE_MS = 180;

const STYLES: Record<ToastKind, string> = {
  success: 'bg-success-bg text-success border-success/30',
  error: 'bg-danger-bg text-danger border-danger/30',
  info: 'bg-card text-foreground border-border',
};

const ICONS: Record<ToastKind, string> = { success: '✅', error: '⚠️', info: '↩️' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Takes the balloon `id` away — unless a newer one has already taken its place. */
  const dismiss = useCallback(
    (id: string) => {
      setToast((prev) => {
        if (prev?.id !== id) return prev;
        clearTimer();
        return null;
      });
    },
    [clearTimer],
  );

  const schedule = useCallback(
    (next: Toast) => {
      clearTimer();
      timer.current = setTimeout(() => dismiss(next.id), next.action ? WITH_ACTION_MS : VISIBLE_MS);
    },
    [clearTimer, dismiss],
  );

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'success', options?: { action?: ToastAction }) => {
      const next = { id: createId(), kind, message, action: options?.action };
      setToast(next);
      schedule(next);
    },
    [schedule],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Above the Início's dots and up-arrow (and the widget tray), below the sheets, and never
          blocking taps when empty. */}
      <div
        className="pointer-events-none fixed inset-x-0 z-[45] flex flex-col items-center px-4"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.75rem)' }}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <SwipeableToast
            key={toast.id}
            toast={toast}
            onDismiss={() => dismiss(toast.id)}
            onHold={clearTimer}
            onRelease={() => schedule(toast)}
          />
        )}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * One balloon that follows the finger sideways and, when let go far or fast enough, slides off
 * and goes away — the same gesture that clears a notification on a phone. A short drag springs
 * back. While the finger is on it the balloon does not time out (`onHold` / `onRelease`).
 * The pointer is only captured once the drag is clearly sideways, so a plain tap still reaches
 * the "Desfazer" button; a real drag swallows the click that follows it.
 */
function SwipeableToast({
  toast,
  onDismiss,
  onHold,
  onRelease,
}: {
  toast: Toast;
  onDismiss: () => void;
  onHold: () => void;
  onRelease: () => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragXRef = useRef(0);
  const [width, setWidth] = useState(1);
  const start = useRef<{ x: number; time: number } | null>(null);
  const moved = useRef(false);
  const leaving = useRef(false);

  function setOffset(value: number) {
    dragXRef.current = value;
    setDragX(value);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (leaving.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    start.current = { x: event.clientX, time: event.timeStamp };
    moved.current = false;
    onHold();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    if (!moved.current) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      moved.current = true;
      setWidth(event.currentTarget.offsetWidth || 1);
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setOffset(dx);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const elapsed = Math.max(event.timeStamp - start.current.time, 1);
    start.current = null;
    setDragging(false);
    const dx = dragXRef.current;
    const flung = Math.abs(dx) >= FLING_MIN && Math.abs(dx) / elapsed >= FLING_SPEED;
    if (moved.current && (Math.abs(dx) >= width * DISMISS_SHARE || flung)) {
      leaving.current = true;
      setOffset((dx < 0 ? -1 : 1) * (width + 32));
      window.setTimeout(onDismiss, SLIDE_MS);
    } else {
      setOffset(0);
      onRelease();
    }
  }

  function swallowClickAfterDrag(event: MouseEvent<HTMLDivElement>) {
    if (!moved.current) return;
    moved.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    // The pop-in lives on the outer box so it never fights the drag's own transform.
    <div className="motion-safe:animate-toast-in pointer-events-auto w-full max-w-sm">
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={swallowClickAfterDrag}
        className="select-none"
        style={{
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          opacity: dragX ? Math.max(1 - Math.abs(dragX) / width, 0) : undefined,
          transition: dragging ? 'none' : `transform ${SLIDE_MS}ms ease-out, opacity ${SLIDE_MS}ms ease-out`,
          touchAction: 'pan-y',
        }}
      >
        {toast.action ? (
          <div
            className={`flex w-full items-center gap-2 rounded-xl border py-2 pr-2 pl-4 text-left text-sm font-medium shadow-lg ${STYLES[toast.kind]}`}
          >
            <span aria-hidden>{ICONS[toast.kind]}</span>
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => {
                onDismiss();
                toast.action?.onClick();
              }}
              className="min-h-[40px] shrink-0 rounded-lg px-3 font-semibold underline underline-offset-2"
            >
              {toast.action.label}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onDismiss}
            className={`flex w-full items-start gap-2 rounded-xl border px-4 py-3 text-left text-sm font-medium shadow-lg ${STYLES[toast.kind]}`}
          >
            <span aria-hidden>{ICONS[toast.kind]}</span>
            <span className="flex-1">{toast.message}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return ctx;
}
