'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeftRight, Minus, Rows2, Square } from 'lucide-react';
import type { HomeWidgetKey } from '@/lib/budget';
import { widgetName } from '@/lib/modules';
import { Card } from './HomeCards';

/**
 * A widget in edit mode. The whole card is the handle (held, then dragged — see the sensors in
 * `HomeScreen`), with the dashed outline; the "−" takes it off the Início (it waits in the widget
 * tray), "Mover" sends it to another tela without dragging, and a tile can be stretched to the
 * whole row or split again.
 */
export function EditableWidget({
  widget,
  size,
  resizable,
  tourAnchor,
  ghost,
  onToggleSize,
  onRemove,
  onMove,
}: {
  widget: HomeWidgetKey;
  size: 'half' | 'full';
  resizable: boolean;
  /** The widget the "Como organizar a Início" tour points at. */
  tourAnchor?: boolean;
  /** Being placed from the widget tray: shown faded until it is dropped. */
  ghost?: boolean;
  onToggleSize: () => void;
  onRemove: () => void;
  onMove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget,
  });
  const name = widgetName(widget);

  return (
    <div
      ref={setNodeRef}
      data-home-widget
      data-tour={tourAnchor ? 'inicio-widget' : undefined}
      // `CSS.Translate`, not `CSS.Transform`: the sortable transform of a grid with cards of two
      // widths also carries a scale, which is what stretched a card out of shape mid-move before
      // it snapped back on landing. Only the movement is wanted; every card keeps its own size.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative min-w-0 ${size === 'full' ? 'col-span-2' : 'col-span-1'}`}
    >
      {/* The card itself stays where it was, faded, while its copy follows the finger (the overlay). */}
      <div
        className={`pointer-events-none rounded-2xl transition-opacity duration-150 ${
          isDragging || ghost ? 'opacity-30' : ''
        }`}
      >
        <Card moduleKey={widget} />
      </div>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Segurar e arrastar ${name} para reorganizar`}
        className="ring-primary/60 active:bg-primary/5 ring-dashed absolute inset-0 touch-manipulation rounded-2xl ring-2"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Tirar ${name} da Início`}
        title="Tirar da Início"
        className="bg-danger-fill absolute -top-2 -left-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-white shadow-md"
      >
        <Minus aria-hidden className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onMove}
        aria-label={`Mover ${name} para outra tela`}
        title="Mover para outra tela"
        className="border-border bg-card text-foreground absolute -top-2 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold shadow-md"
      >
        <ArrowLeftRight aria-hidden className="h-3.5 w-3.5" />
        Mover
      </button>
      {resizable && (
        <button
          type="button"
          onClick={onToggleSize}
          aria-label={size === 'full' ? `Dividir a linha de ${name}` : `Esticar ${name} para a linha toda`}
          title={size === 'full' ? 'Linha inteira — toque para dividir' : 'Metade — toque para esticar'}
          className="bg-primary text-primary-foreground absolute -top-2 -right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full shadow-md"
        >
          {size === 'full' ? (
            <Rows2 aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <Square aria-hidden className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
