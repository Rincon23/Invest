'use client';

import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';

/** How far (px) a drag must go before releasing it removes the row, Android-notification style. */
const DELETE_THRESHOLD = 96;

/**
 * Wraps a row so dragging it left or right removes it (`onDelete`), the same gesture Android uses
 * to dismiss a notification. `touch-action: pan-y` keeps normal vertical scrolling of the list
 * working — only the horizontal drag is ours to read. The live offset is also kept in a ref
 * (`dragXRef`), not just in state: `endDrag` needs the value exactly as of the last pointer
 * move, and state updates from a fast-moving gesture are not guaranteed to have re-rendered yet.
 */
export function SwipeToDelete({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragXRef = useRef(0);
  const startX = useRef<number | null>(null);
  const removing = useRef(false);

  function setOffset(value: number) {
    dragXRef.current = value;
    setDragX(value);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (removing.current) return;
    startX.current = event.clientX;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (startX.current === null) return;
    setOffset(event.clientX - startX.current);
  }

  function endDrag() {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);
    if (Math.abs(dragXRef.current) >= DELETE_THRESHOLD) {
      removing.current = true;
      setOffset(dragXRef.current < 0 ? -window.innerWidth : window.innerWidth);
      window.setTimeout(onDelete, 180);
    } else {
      setOffset(0);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div
        aria-hidden
        className="bg-danger absolute inset-0 flex items-center justify-center text-white"
        style={{ opacity: Math.min(Math.abs(dragX) / DELETE_THRESHOLD, 1) }}
      >
        <Trash2 className="h-5 w-5" />
      </div>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: dragging ? 'none' : 'transform 180ms ease-out',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  );
}
