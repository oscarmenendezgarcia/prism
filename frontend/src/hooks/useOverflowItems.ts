/**
 * useOverflowItems — generic responsive overflow measurement hook.
 * ADR-1 (space-tabs-overflow): measures tab widths via DOM refs + ResizeObserver
 * and returns which items fit the container vs. which overflow.
 *
 * Architecture:
 *   - The container element is held in STATE (not just a ref) so that when it
 *     is first attached, it triggers a re-render and the measurement pass runs.
 *   - Item elements are held in a ref (Map) — they do not need to cause renders.
 *   - The ResizeObserver is set up once per container (depends on [container]
 *     only) and calls the latest recompute via a ref, so adding/removing items
 *     or changing the pinned id never re-registers the observer.
 *
 * Two-pass design:
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

  // Force pinned item into visible if it ended up in overflow.
  if (pinnedId && !visible.some((i) => i.id === pinnedId)) {
    const overflowIdx = overflow.findIndex((i) => i.id === pinnedId);
    if (overflowIdx >= 0) {
      // Pull the pinned item out of overflow, then bump as many trailing visible
      // items as needed so the pinned tab actually FITS the budget — a wide pinned
      // tab can need more than one slot, otherwise the visible set overshoots and
      // the trailing buttons end up overlapping/clipping the last tab.
      const [pinned] = overflow.splice(overflowIdx, 1);
      const pinnedW = itemWidths.get(pinned.id) ?? 0;
      while (visible.length > 0) {
        const pinnedAddition = visible.length > 0 ? pinnedW + gapPx : pinnedW;
        if (used + pinnedAddition <= available) break;
        const bumped = visible.pop()!;
        const bw = itemWidths.get(bumped.id) ?? 0;
        // Subtract the bumped item's contribution (it had a leading gap unless it
        // was the first visible item, which is now decided by the new length).
        used -= visible.length > 0 ? bw + gapPx : bw;
        overflow.unshift(bumped);
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

  // Container is STATE so attaching it triggers a re-render (enabling the measure pass).
  const [container, setContainer] = useState<HTMLElement | null>(null);

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

  // Latest recompute, kept in a ref so the ResizeObserver effect can call the
  // current closure without listing `recompute` as a dependency (which would
  // tear down and re-create the observer on every items/pinnedId change).
  const recomputeRef = useRef(recompute);
  recomputeRef.current = recompute;

  // ---------------------------------------------------------------------------
  // Pass 1: measure all item widths after render when measuring=true.
  // NOTE: intentionally no dependency array — this must run after *every* render
  // and self-gates via `measuring`. Do not add deps; it would skip measure passes.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (!measuring) return;

    // Special-case: empty list — settle immediately without needing the container
    if (items.length === 0) {
      setVisible([]);
      setOverflow([]);
      setMeasuring(false);
      return;
    }

    if (!container) return;

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

    recompute(container.getBoundingClientRect().width);
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
    if (measuring || !container) return;
    recompute(container.getBoundingClientRect().width);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedId]);

  // ---------------------------------------------------------------------------
  // ResizeObserver — set up once per container; recompute on resize.
  // Depends on [container] only and calls recompute via recomputeRef, so adding
  // a space / changing the active tab never tears down and re-observes.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (!container) return;
    if (typeof ResizeObserver === 'undefined') return; // SSR / very old browser

    const handleResize = () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        recomputeRef.current(container.getBoundingClientRect().width);
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
  }, [container]);

  // ---------------------------------------------------------------------------
  // Re-measure once web fonts have loaded. The first measure pass can run with a
  // fallback font (e.g. a cold / incognito load before Inter is ready), so the
  // captured tab widths don't match the final render — leaving tabs needlessly in
  // overflow (or clipped) with empty space beside them. `document.fonts.ready`
  // resolves when fonts are ready (immediately on a warm cache) → re-measure once.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (!container) return;
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts || !fonts.ready) return;
    let cancelled = false;
    fonts.ready.then(() => {
      if (!cancelled) setMeasuring(true);
    });
    return () => { cancelled = true; };
  }, [container]);

  // ---------------------------------------------------------------------------
  // Stable ref callbacks
  // ---------------------------------------------------------------------------
  const containerRef = useCallback((el: HTMLElement | null) => {
    setContainer(el);
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
