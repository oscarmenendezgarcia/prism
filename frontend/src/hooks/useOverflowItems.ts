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
  /**
   * ids that must never be placed in overflow (the active space + every pinned
   * space). These win the visible slots over non-pinned items. Takes precedence
   * over `pinnedId` when provided. Among forced ids, earlier list order wins if
   * not all of them fit.
   */
  pinnedIds?: string[];
  /**
   * The active item id — always kept visible (highest priority), even if it has
   * to overshoot in an extreme-narrow window. Defaults to `pinnedId` when omitted.
   */
  activeId?: string;
  /**
   * Extra signal that an item's *rendered width* may have changed even though the
   * item id list is identical (e.g. a tab gains/loses a pin icon). When this value
   * changes the hook re-measures, so cached widths never go stale. Active-item
   * changes should NOT be folded in here — those only need a recompute, not a
   * re-measure, and re-measuring on every tab switch would flash the strip.
   */
  measureKey?: string;
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
 * Priority left-to-right fit. Three tiers compete for the visible slots:
 *
 *   1. the active item (`always`) — ALWAYS visible (may overshoot in an extreme
 *      narrow window; it's a single tab, like the original behaviour);
 *   2. forced items (pinned spaces) — placed in order while they fit; the first
 *      one that doesn't fit, and every forced item after it, falls to overflow
 *      (with its pin marker) instead of overshooting and clipping the +N button;
 *   3. the rest (non-pinned) — fill whatever space remains, in order.
 *
 * This guarantees pinned tabs beat non-pinned tabs for the visible slots WITHOUT
 * ever overshooting the trailing buttons.
 */
function computeSplit<T extends { id: string }>(
  items: T[],
  containerWidth: number,
  itemWidths: Map<string, number>,
  forced: Set<string>,
  always: string | undefined,
  reservedTrailingPx: number,
  gapPx: number,
): { visible: T[]; overflow: T[] } {
  if (items.length === 0) return { visible: [], overflow: [] };

  const available = Math.max(0, containerWidth - reservedTrailingPx);
  const visible: T[] = [];
  const overflow: T[] = [];

  const widthOf = (arr: T[]) =>
    arr.reduce((acc, it, idx) => acc + (itemWidths.get(it.id) ?? 0) + (idx > 0 ? gapPx : 0), 0);
  const fits = (item: T) => {
    const w = itemWidths.get(item.id) ?? 0;
    const addition = visible.length > 0 ? w + gapPx : w;
    return widthOf(visible) + addition <= available;
  };

  // Tier 1 + 2 — forced items (active first, then pinned in order).
  const forcedItems = items.filter((i) => forced.has(i.id));
  const orderedForced: T[] = [];
  const activeItem = always ? forcedItems.find((i) => i.id === always) : undefined;
  if (activeItem) orderedForced.push(activeItem);
  for (const it of forcedItems) if (it.id !== always) orderedForced.push(it);

  let forcedBlocked = false; // once a pinned tab doesn't fit, later pinned overflow too
  for (const it of orderedForced) {
    if (it.id === always) {
      visible.push(it); // active is always visible
    } else if (!forcedBlocked && fits(it)) {
      visible.push(it);
    } else {
      forcedBlocked = true;
      overflow.push(it);
    }
  }

  // Tier 3 — non-forced fill the remaining space, in order.
  let restBlocked = false;
  for (const it of items) {
    if (forced.has(it.id)) continue;
    if (!restBlocked && fits(it)) {
      visible.push(it);
    } else {
      restBlocked = true;
      overflow.push(it);
    }
  }

  // Restore original (pinned-first) order in both buckets.
  const orderIndex = new Map(items.map((it, i) => [it.id, i]));
  const byOrder = (a: T, b: T) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
  visible.sort(byOrder);
  overflow.sort(byOrder);

  return { visible, overflow };
}

export function useOverflowItems<T extends { id: string }>(
  items: T[],
  opts: OverflowOptions = {},
): OverflowResult<T> {
  const { pinnedId, pinnedIds, activeId, measureKey, reservedTrailingPx = 72, gapPx = 2 } = opts;

  // Forced-visible ids: explicit pinnedIds win; fall back to the single pinnedId.
  const forcedList = pinnedIds ?? (pinnedId ? [pinnedId] : []);
  // The always-visible (active) item — explicit activeId, else the single pinnedId.
  const alwaysId = activeId ?? pinnedId;
  // Stable key so effects/recompute only refresh when the *set* actually changes,
  // not on every render (forcedList is a fresh array each time).
  const pinnedKey = `${forcedList.join('\0')}|${alwaysId ?? ''}`;

  // Container is STATE so attaching it triggers a re-render (enabling the measure pass).
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const itemEls = useRef<Map<string, HTMLElement>>(new Map());
  const itemWidths = useRef<Map<string, number>>(new Map());
  const rafId = useRef<number | null>(null);

  const [measuring, setMeasuring] = useState(true);
  const [visible, setVisible] = useState<T[]>([]);
  const [overflow, setOverflow] = useState<T[]>([]);

  // Stable stringified key of items — used to detect identity changes. measureKey
  // is folded in so a width-affecting change with the same ids (e.g. a tab gains a
  // pin icon) also forces a fresh measure pass.
  const itemIds = items.map((i) => i.id).join('\0');
  const remeasureKey = measureKey != null ? `${itemIds}${measureKey}` : itemIds;
  const prevRemeasureKey = useRef('');

  // ---------------------------------------------------------------------------
  // Core split computation — called after measuring or on resize
  // ---------------------------------------------------------------------------
  const recompute = useCallback(
    (containerWidth: number) => {
      const result = computeSplit(
        items,
        containerWidth,
        itemWidths.current,
        new Set(forcedList),
        alwaysId,
        reservedTrailingPx,
        gapPx,
      );
      setVisible(result.visible);
      setOverflow(result.overflow);
    },
    // forcedList is rebuilt each render; pinnedKey captures its content for memoization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, pinnedKey, reservedTrailingPx, gapPx],
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
  // Reset to measuring when items change (added / removed / renamed / reordered)
  // or when measureKey signals a width-affecting change (pin icon toggled).
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (remeasureKey !== prevRemeasureKey.current) {
      prevRemeasureKey.current = remeasureKey;
      setMeasuring(true);
    }
  }, [remeasureKey]);

  // ---------------------------------------------------------------------------
  // Recompute immediately when pinnedId changes (active space changes)
  // Items list is unchanged so widths are still valid — no re-measure needed.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (measuring || !container) return;
    recompute(container.getBoundingClientRect().width);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedKey]);

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
