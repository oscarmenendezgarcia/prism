/**
 * useOverflowItems — generic responsive overflow measurement hook.
 * ADR-1 (space-tabs-overflow): measures tab widths via DOM refs + ResizeObserver
 * and returns which items fit the container vs. which overflow.
 *
 * Algorithm:
 *   Pass 1 (measuring=true): render ALL items invisible, read their widths, recompute.
 *   Pass 2 (measuring=false): render only visible items + overflow button.
 *   On resize: recompute using cached widths (no re-measure).
 *   On items change: reset to measuring=true and repeat.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface OverflowOptions {
  /** id of an item that must never be placed in overflow (e.g., the active space). */
  pinnedId?: string;
  /** px reserved on the trailing edge for the "+N" button + add button. Default: 72. */
  reservedTrailingPx?: number;
  /** px gap between items. Default: 2. */
  gapPx?: number;
}

export interface OverflowResult<T> {
  containerRef: (el: HTMLElement | null) => void;
  setItemRef: (id: string) => (el: HTMLElement | null) => void;
  visible: T[];
  overflow: T[];
  /** true before the first measurement settles (all items rendered, hidden). */
  measuring: boolean;
}

/**
 * Greedy left-to-right fit: accumulate item widths until the available space is
 * exhausted, then collect the rest in overflow. After fitting, force the pinned
 * item into visible (bumping the last non-pinned visible item to overflow if needed).
 */
function computeSplit<T extends { id: string }>(
  items: T[],
  containerWidth: number,
  itemWidths: Map<string, number>,
  pinnedId: string | undefined,
  reservedTrailingPx: number,
  gapPx: number,
): { visible: T[]; overflow: T[] } {
  if (items.length === 0) return { visible: [], overflow: [] };

  const available = Math.max(0, containerWidth - reservedTrailingPx);
  const visible: T[] = [];
  const overflow: T[] = [];
  let used = 0;

  for (const item of items) {
    const w = itemWidths.get(item.id) ?? 0;
    const addition = visible.length > 0 ? w + gapPx : w;
    if (used + addition <= available) {
      visible.push(item);
      used += addition;
    } else {
      overflow.push(item);
    }
  }

  // Force pinned item into visible if it ended up in overflow
  if (pinnedId && !visible.some((i) => i.id === pinnedId)) {
    const overflowIdx = overflow.findIndex((i) => i.id === pinnedId);
    if (overflowIdx >= 0) {
      // Pull the pinned item out of overflow
      const [pinned] = overflow.splice(overflowIdx, 1);
      // Drop the last visible non-pinned item (bump it to overflow) to stay within budget
      const last = visible[visible.length - 1];
      if (last && last.id !== pinnedId) {
        visible.pop();
        overflow.unshift(last);
      }
      visible.push(pinned);
    }
  }

  return { visible, overflow };
}

export function useOverflowItems<T extends { id: string }>(
  items: T[],
  opts: OverflowOptions = {},
): OverflowResult<T> {
  const { pinnedId, reservedTrailingPx = 72, gapPx = 2 } = opts;

  const containerEl = useRef<HTMLElement | null>(null);
  const itemEls = useRef<Map<string, HTMLElement>>(new Map());
  const itemWidths = useRef<Map<string, number>>(new Map());
  const rafId = useRef<number | null>(null);

  const [measuring, setMeasuring] = useState(true);
  const [visible, setVisible] = useState<T[]>([]);
  const [overflow, setOverflow] = useState<T[]>([]);

  // Stable stringified key of items — used to detect identity changes
  const itemIds = items.map((i) => i.id).join('\0');
  const prevItemIds = useRef('');

  // ---------------------------------------------------------------------------
  // Core split computation — called after measuring or on resize
  // ---------------------------------------------------------------------------
  const recompute = useCallback(
    (containerWidth: number) => {
      const result = computeSplit(
        items,
        containerWidth,
        itemWidths.current,
        pinnedId,
        reservedTrailingPx,
        gapPx,
      );
      setVisible(result.visible);
      setOverflow(result.overflow);
    },
    [items, pinnedId, reservedTrailingPx, gapPx],
  );

  // ---------------------------------------------------------------------------
  // Pass 1: measure all item widths after render when measuring=true
  // Runs after every render; exits immediately when measuring=false.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (!measuring) return;
    if (!containerEl.current) return;

    // Capture current item widths
    const currentIds = new Set(items.map((i) => i.id));
    for (const item of items) {
      const el = itemEls.current.get(item.id);
      if (el) {
        itemWidths.current.set(item.id, el.getBoundingClientRect().width);
      }
    }
    // Remove stale entries
    for (const id of [...itemWidths.current.keys()]) {
      if (!currentIds.has(id)) itemWidths.current.delete(id);
    }

    const containerWidth = containerEl.current.getBoundingClientRect().width;
    recompute(containerWidth);
    setMeasuring(false);
  });

  // ---------------------------------------------------------------------------
  // Reset to measuring when items change (new space added / removed / renamed)
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (itemIds !== prevItemIds.current) {
      prevItemIds.current = itemIds;
      setMeasuring(true);
    }
  }, [itemIds]);

  // ---------------------------------------------------------------------------
  // Recompute immediately when pinnedId changes (active space changes)
  // Items list is unchanged so widths are still valid — no re-measure needed.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (measuring || !containerEl.current) return;
    recompute(containerEl.current.getBoundingClientRect().width);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedId]);

  // ---------------------------------------------------------------------------
  // ResizeObserver — recompute on container width change (rAF-gated)
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    const container = containerEl.current;
    if (!container) return;
    if (typeof ResizeObserver === 'undefined') {
      // SSR / very old browser fallback — noop (measuring pass covers initial layout)
      return;
    }

    const handleResize = () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        if (!containerEl.current) return;
        recompute(containerEl.current.getBoundingClientRect().width);
        rafId.current = null;
      });
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [recompute]);

  // ---------------------------------------------------------------------------
  // Stable ref callbacks
  // ---------------------------------------------------------------------------
  const containerRef = useCallback((el: HTMLElement | null) => {
    containerEl.current = el;
  }, []);

  const setItemRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) {
        itemEls.current.set(id, el);
      } else {
        itemEls.current.delete(id);
      }
    },
    [],
  );

  return { containerRef, setItemRef, visible, overflow, measuring };
}
