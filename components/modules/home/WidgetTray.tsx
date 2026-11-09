'use client';

import { useRef, type RefObject } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { HomeWidgetKey } from '@/lib/budget';
import { widgetDescription, widgetName } from '@/lib/modules';
import { drawerCommits } from '@/components/layout/AppDrawer';
import { BACK_MS, EASE } from '@/components/layout/swipePhysics';
import { useVerticalDrag } from '@/components/layout/useVerticalDrag';
import { IconTile } from '@/components/ui/IconTile';
import { widgetVisual } from '../visuals';
import { effectiveSize } from './HomeCards';

/** The droppable id of the tray's bar: a widget picked up from the tray and let go there stays in it. */
export const TRAY_ID = 'widget-tray';
/** The draggable id of a widget picked up from the tray. */
export const trayDragId = (key: HomeWidgetKey) => `tray:${key}`;
export const widgetOfTrayDrag = (id: string | number): HomeWidgetKey | null =>
  typeof id === 'string' && id.startsWith('tray:') ? (id.slice(5) as HomeWidgetKey) : null;

/** How much of the tray shows while it is closed: the bar with "Widgets". */
export const TRAY_BAR_HEIGHT = '3.5rem';

const restTransform = (open: boolean) =>
  open ? 'translate3d(0, 0, 0)' : `translate3d(0, calc(100% - ${TRAY_BAR_HEIGHT}), 0)`;
const REST_TRANSITION = `transform ${BACK_MS}ms ${EASE}`;

/**
 * The widget tray of edit mode, at the bottom of the Início where the up-arrow was. Closed, it is
 * a bar saying how many widgets wait in it; a tap or a drag up opens it to half the screen.
 *
 * It lists the widgets that are on no tela (the ones taken off) — a tap puts one at the end of
 * the tela on screen, a hold-and-drag drops it exactly where it goes. A restricted module's widgets
 * never show up for an account without access. A widget only comes here by its "−": dragging one onto the
 * tray never takes it off the Início. (The back button closes the tray before it leaves edit
 * mode: `HomeScreen` handles that, with edit mode's own history entry.)
 */
export function WidgetTray({
  open,
  onOpenChange,
  hidden,
  sizes,
  trayDrag,
  dragActive,
  onAdd,
  onRestoreDefault,
  barRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hidden: HomeWidgetKey[];
  sizes: Partial<Record<HomeWidgetKey, 'half' | 'full'>>;
  /** A widget picked up from the tray is being dragged: letting go on the bar leaves it there. */
  trayDrag: boolean;
  /** Any drag at all, the tray's own included: its list must stay live under the finger. */
  dragActive: boolean;
  onAdd: (key: HomeWidgetKey) => void;
  onRestoreDefault: () => void;
  /**
   * The bar, for `HomeScreen` to tell whether the finger is over it while a widget from the tray
   * is dragged. Closed, the rest of the tray is below the screen.
   */
  barRef: RefObject<HTMLButtonElement | null>;
}) {
  // On the bar, never on the whole panel: dnd-kit measures a droppable without its own transform,
  // and the closed panel is pushed down by one — measured like that, it covered the lower half of
  // the screen.
  const { setNodeRef } = useDroppable({ id: TRAY_ID });
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLButtonElement>(null);

  const travel = () => (panel.current?.offsetHeight ?? 0) - (bar.current?.offsetHeight ?? 0);
  const { wasDragged } = useVerticalDrag(bar, {
    direction: open ? 'down' : 'up',
    onMove: (distance) => {
      const el = panel.current;
      if (!el) return;
      const max = travel();
      const offset = open ? Math.min(distance, max) : Math.max(max - distance, 0);
      el.style.transition = 'none';
      el.style.transform = `translate3d(0, ${offset}px, 0)`;
    },
    onEnd: (distance, speed) => {
      const el = panel.current;
      if (el) {
        el.style.transition = REST_TRANSITION;
        el.style.transform = restTransform(open);
      }
      if (drawerCommits(distance, travel(), speed)) onOpenChange(!open);
    },
  });

  const count = hidden.length;

  return (
    <div
      ref={panel}
      data-no-swipe-nav
      className="border-border bg-card absolute inset-x-0 z-40 flex h-[50dvh] flex-col rounded-t-3xl border-t shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
      style={{
        bottom: 'env(safe-area-inset-bottom)',
        transform: restTransform(open),
        transition: REST_TRANSITION,
      }}
    >
      <button
        ref={(node) => {
          bar.current = node;
          barRef.current = node;
          setNodeRef(node);
        }}
        type="button"
        onClick={() => {
          if (!wasDragged() && !dragActive) onOpenChange(!open);
        }}
        aria-expanded={open}
        aria-controls="bandeja-widgets"
        className="bg-card text-foreground flex shrink-0 flex-col items-center justify-center rounded-t-3xl px-4"
        style={{ height: TRAY_BAR_HEIGHT }}
      >
        {trayDrag ? (
          <span className="text-muted text-sm font-semibold">Solte aqui para deixar na bandeja</span>
        ) : (
          <>
            <span aria-hidden className="bg-border mb-1 h-1 w-10 rounded-full" />
            {/* The tour's spotlight goes on the label, not the bar: the bar ends right at the bottom
                edge, and a spotlight on what is not fully in view scrolls the screen to it. */}
            <span data-tour="inicio-bandeja" className="flex items-center gap-2 text-sm font-semibold">
              {open ? (
                <ChevronDown aria-hidden className="h-4 w-4" />
              ) : (
                <ChevronUp aria-hidden className="h-4 w-4" />
              )}
              Widgets
              <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
                {count}
              </span>
            </span>
          </>
        )}
      </button>

      <div
        id="bandeja-widgets"
        role="region"
        aria-label="Bandeja de widgets"
        inert={!open && !dragActive}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="flex flex-col gap-4">
          {count === 0 ? (
            <p className="text-muted text-sm">
              Todos os widgets já estão na Início. Toque em{' '}
              <span className="bg-danger-fill inline-flex h-4 w-4 items-center justify-center rounded-full align-text-bottom text-xs font-bold text-white">
                −
              </span>{' '}
              num widget para guardar ele aqui.
            </p>
          ) : (
            <section className="flex flex-col gap-2">
              <p className="text-muted text-xs">
                Toque para pôr nesta tela, ou segure e arraste até o lugar.
              </p>
              <ul className="flex flex-col gap-2">
                {hidden.map((key) => (
                  <TrayWidget
                    key={key}
                    widget={key}
                    size={effectiveSize(key, sizes) ?? 'half'}
                    onAdd={() => onAdd(key)}
                  />
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-col items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onRestoreDefault}
              className="text-muted hover:text-foreground text-sm font-medium underline underline-offset-2"
            >
              Voltar ao padrão
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const sizeLabel = (size: 'half' | 'full') => (size === 'full' ? 'Linha inteira' : 'Meia linha');

/** A widget waiting in the tray: a tap adds it to the tela on screen, a hold picks it up. */
function TrayWidget({
  widget,
  size,
  onAdd,
}: {
  widget: HomeWidgetKey;
  size: 'half' | 'full';
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: trayDragId(widget) });
  // Enter and Space keep meaning "add" (a keyboard drag here would have nowhere visible to go):
  // only the pointer half of the drag is wired in.
  const pointerListeners = { ...listeners };
  delete pointerListeners.onKeyDown;
  const visual = widgetVisual(widget);

  return (
    <li ref={setNodeRef} className={isDragging ? 'opacity-40' : ''}>
      <button
        type="button"
        {...attributes}
        {...pointerListeners}
        onClick={onAdd}
        aria-label={`Pôr ${widgetName(widget)} na Início`}
        className="border-border bg-background hover:border-primary/40 flex w-full touch-manipulation items-center gap-3 rounded-xl border p-3 text-left"
      >
        <IconTile icon={visual.icon} tone={visual.tone} />
        <span className="min-w-0 flex-1">
          <span className="text-foreground block font-medium">{widgetName(widget)}</span>
          <span className="text-muted block text-xs">{widgetDescription(widget)}</span>
          <span className="text-muted mt-0.5 block text-[11px] font-medium">{sizeLabel(size)}</span>
        </span>
        <span className="bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <Plus aria-hidden className="h-4 w-4" />
        </span>
      </button>
    </li>
  );
}
