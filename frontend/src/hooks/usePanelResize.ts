/**
 * Hook for making a side panel horizontally resizable via a left-edge drag handle.
 *
 * ADR-1 (allow-resize-settings) §Decision: custom drag handle, width persisted per panel
 * in localStorage via the existing useLocalStorage hook. No Zustand involvement — this
 * is purely presentational state local to each panel.
 *
 * The panel sits on the right side of the layout, so dragging left widens it and dragging
 * right narrows it: delta = startX - e.clientX (positive delta → wider).
 *
 * Width is clamped on every render so stale stored values from a narrower viewport are
 * always safe.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';

export interface UsePanelResizeOptions {
  /** localStorage key, e.g. 'prism:panel-width:config'. */
  storageKey: string;
  /** Initial width in px when nothing is stored yet. Default: 480. */
  defaultWidth: number;
  /** Minimum allowed width in px. Default: 320. */
  minWidth: number;
  /** Maximum allowed width in px. Default: 800. */
  maxWidth: number;
}

export interface UsePanelResizeResult {
  /** Current clamped panel width in px. Bind to `style={{ width }}` on the panel element. */
  width: number;
  /** Attach to the `onMouseDown` prop of the drag handle element. */
  handleMouseDown: (e: React.MouseEvent) => void;
  /** minWidth, forwarded for aria-valuemin on the drag handle. */
  minWidth: number;
  /** maxWidth, forwarded for aria-valuemax on the drag handle. */
  maxWidth: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function usePanelResize({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: UsePanelResizeOptions): UsePanelResizeResult {
  const [storedWidth, setStoredWidth] = useLocalStorage<number>(storageKey, defaultWidth);

  // Guard against non-numeric values written manually to localStorage (e.g. via DevTools).
  const safeStored = Number.isFinite(storedWidth) ? storedWidth : defaultWidth;

  // Always serve a clamped value so stale stored widths (e.g. from a wider monitor
  // session) never violate the current bounds.
  const width = clamp(safeStored, minWidth, maxWidth);

  // Drag state held in a ref so the mousemove handler can read it without being
  // recreated on every render.
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Ref to the cleanup function so it can be called from the useEffect return.
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      const startX = e.clientX;
      const startWidth = width;

      dragRef.current = { startX, startWidth };

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startX - moveEvent.clientX;
        const newWidth = clamp(dragRef.current.startWidth + delta, minWidth, maxWidth);
        setStoredWidth(newWidth);
      };

      const onMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        cleanupRef.current = null;
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      // Store cleanup so useEffect can remove listeners if the component unmounts
      // mid-drag (ADR-1 §Consequences — memory-leak mitigation).
      cleanupRef.current = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    },
    [width, minWidth, maxWidth, setStoredWidth]
  );

  // Remove dangling listeners on unmount.
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  return { width, handleMouseDown, minWidth, maxWidth };
}
