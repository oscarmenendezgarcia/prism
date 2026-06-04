/**
 * SpaceOverflowMenu — "+N" overflow trigger + portal dropdown for hidden spaces.
 *
 * Behaviour:
 *   - Ghost "+N" button that opens a portal dropdown listing overflow spaces.
 *   - Filter input appears when overflow count > filterThreshold (default 6).
 *   - Keyboard navigation: arrows move through items, Enter selects, Escape closes.
 *   - Closes on outside click or Escape.
 *   - data-testid="space-overflow-btn" + data-overflow-count for E2E tests.
 *
 * ADR-1 (space-tabs-overflow): reuses ContextMenu portal/positioning pattern.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Space } from '@/types';

export interface SpaceOverflowMenuProps {
  /** Spaces that did not fit the visible tab bar */
  spaces: Space[];
  activeSpaceId: string;
  onSelect: (spaceId: string) => void;
  /** Show filter input when overflow count exceeds this. Default: 6. */
  filterThreshold?: number;
}

export function SpaceOverflowMenu({
  spaces,
  activeSpaceId,
  onSelect,
  filterThreshold = 6,
}: SpaceOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const showFilter = spaces.length > filterThreshold;

  const filteredSpaces = filter
    ? spaces.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
    : spaces;

  // ---------------------------------------------------------------------------
  // Open / close helpers
  // ---------------------------------------------------------------------------
  function openDropdown() {
    setOpen(true);
    setFilter('');
    setFocusedIdx(showFilter ? -1 : 0);
  }

  function closeDropdown() {
    setOpen(false);
    setFilter('');
    setFocusedIdx(-1);
    triggerRef.current?.focus();
  }

  function selectSpace(spaceId: string) {
    onSelect(spaceId);
    closeDropdown();
  }

  // ---------------------------------------------------------------------------
  // Auto-focus filter input or first item when dropdown opens
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (showFilter && filterInputRef.current) {
        filterInputRef.current.focus();
      } else if (itemRefs.current[0]) {
        itemRefs.current[0]?.focus();
        setFocusedIdx(0);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, showFilter]);

  // Move DOM focus to match focusedIdx
  useEffect(() => {
    if (!open || focusedIdx < 0) return;
    itemRefs.current[focusedIdx]?.focus();
  }, [focusedIdx, open]);

  // ---------------------------------------------------------------------------
  // Close on outside click
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        closeDropdown();
      }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Global Escape listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDropdown();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Reset filtered item refs when filteredSpaces changes
  // ---------------------------------------------------------------------------
  itemRefs.current = filteredSpaces.map((_, i) => itemRefs.current[i] ?? null);

  // ---------------------------------------------------------------------------
  // Keyboard navigation within the dropdown list
  // ---------------------------------------------------------------------------
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((prev) => Math.min(prev + 1, filteredSpaces.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (focusedIdx <= 0) {
          // Wrap back to filter input (if present) or stay at 0
          if (showFilter && filterInputRef.current) {
            filterInputRef.current.focus();
            setFocusedIdx(-1);
          }
        } else {
          setFocusedIdx((prev) => prev - 1);
        }
      }
    },
    [filteredSpaces.length, focusedIdx, showFilter],
  );

  // Arrow-down on the filter input moves to the first list item.
  // Enter selects the focused item, or — when nothing is focused yet (the user
  // just typed) — the first match, so "filter then Enter" works as expected.
  const handleFilterKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredSpaces.length > 0) setFocusedIdx(0);
      } else if (e.key === 'Enter') {
        const target =
          focusedIdx >= 0 ? filteredSpaces[focusedIdx] : filteredSpaces[0];
        if (target) {
          e.preventDefault();
          selectSpace(target.id);
        }
      }
    },
    [filteredSpaces, focusedIdx], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---------------------------------------------------------------------------
  // Keep the portal anchored to the trigger while open: a scroll or resize moves
  // the trigger, so force a re-render (position is read from triggerRef below).
  // ---------------------------------------------------------------------------
  const [, forceReposition] = useState(0);
  useEffect(() => {
    if (!open) return;
    // Scroll: re-anchor to the sticky tab bar (the trigger only shifts, stays valid).
    const onScroll = () => forceReposition((n) => n + 1);
    // Resize: the whole bar reflows (e.g. crossing into mobile, where panels go
    // full-screen) and the trigger can move or disappear — close instead of
    // re-anchoring, or the portal floats orphaned over other panels.
    const onResize = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true); // capture: catch nested scrollers
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // ---------------------------------------------------------------------------
  // Portal position — anchored below the trigger button
  // ---------------------------------------------------------------------------
  const triggerRect = triggerRef.current?.getBoundingClientRect() ?? null;
  const dropdownStyle: React.CSSProperties = triggerRect
    ? {
        position: 'fixed',
        top: triggerRect.bottom + 4,
        left: Math.min(
          triggerRect.left,
          window.innerWidth - 296, // keep within viewport (280px + 16px margin)
        ),
        zIndex: 200,
      }
    : { position: 'fixed', top: 0, left: 0, zIndex: 200 };

  return (
    <>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Show ${spaces.length} more spaces`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="space-overflow-btn"
        data-overflow-count={spaces.length}
        onClick={openDropdown}
        className={[
          'flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium',
          'flex-shrink-0 transition-all duration-fast select-none whitespace-nowrap',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
          open
            ? 'bg-surface-variant text-text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant',
        ].join(' ')}
      >
        +{spaces.length}
      </button>

      {/* Portal dropdown */}
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="w-[280px] max-w-[90vw] bg-surface-elevated border border-border rounded-md shadow-md overflow-hidden animate-scale-in"
          >
            {/* Filter input */}
            {showFilter && (
              <div className="px-2 pt-2 pb-2 mb-1 border-b border-border">
                <div className="relative flex items-center">
                  <span
                    className="material-symbols-outlined absolute left-2 text-sm leading-none text-text-secondary pointer-events-none"
                    aria-hidden="true"
                  >
                    search
                  </span>
                  <input
                    ref={filterInputRef}
                    type="text"
                    placeholder="search spaces..."
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setFocusedIdx(-1);
                    }}
                    onKeyDown={handleFilterKeyDown}
                    className={[
                      'w-full pl-7 pr-7 py-1.5 text-sm bg-surface rounded-sm',
                      'text-text-primary placeholder:text-text-tertiary',
                      'border border-border focus:border-primary',
                      'focus:outline-none transition-colors duration-fast',
                    ].join(' ')}
                    aria-label="Filter spaces"
                  />
                  {filter && (
                    <button
                      type="button"
                      aria-label="Clear filter"
                      onClick={() => {
                        setFilter('');
                        filterInputRef.current?.focus();
                        setFocusedIdx(-1);
                      }}
                      className="absolute right-2 text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm leading-none">close</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Scrollable list — menu + menuitemradio: single-select navigation (active space is checked) */}
            <ul
              role="menu"
              aria-label="Available spaces"
              onKeyDown={handleListKeyDown}
              className="overflow-y-auto max-h-[352px] p-1"
            >
              {filteredSpaces.length > 0 ? (
                filteredSpaces.map((space, idx) => (
                  <li key={space.id} role="none">
                    <button
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      type="button"
                      role="menuitemradio"
                      aria-checked={space.id === activeSpaceId}
                      onClick={() => selectSpace(space.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          selectSpace(space.id);
                        }
                      }}
                      className={[
                        'w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-sm text-sm',
                        'transition-colors duration-fast cursor-pointer',
                        'focus:outline-none focus-visible:outline-2 focus-visible:outline-primary',
                        space.id === activeSpaceId
                          ? 'bg-primary/8 text-primary font-medium'
                          : 'text-text-primary hover:bg-surface-variant',
                      ].join(' ')}
                    >
                      {space.id === activeSpaceId && (
                        <span
                          className="material-symbols-outlined text-base leading-none flex-shrink-0"
                          aria-hidden="true"
                        >
                          check
                        </span>
                      )}
                      <span className="truncate">{space.name}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-4 text-center text-sm text-text-secondary">
                  No spaces found
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
