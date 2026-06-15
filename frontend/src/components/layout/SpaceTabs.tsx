/**
 * SpaceTabs — responsive space tab bar with overflow handling.
 *
 * Architecture (ADR-1, space-tabs-overflow):
 *   - useOverflowItems measures which spaces fit the container width.
 *   - Visible spaces render as <SpaceTab> components.
 *   - Overflow spaces are reached via <SpaceOverflowMenu> (+N button).
 *   - Active space is always pinned to the visible set (never hidden in overflow).
 *   - No horizontal scroll on ≥sm; the overflow menu owns navigation.
 *
 * Behaviour preserved:
 *   - Switch space → loads board.
 *   - Kebab → Edit (rename) / Delete (disabled when last space).
 *   - Add space button.
 *   - ARIA role="tablist" / role="tab" / aria-selected.
 */

import React, { useState } from 'react';
import { ContextMenu } from '@/components/shared/ContextMenu';
import { useAppStore } from '@/stores/useAppStore';
import { useOverflowItems } from '@/hooks/useOverflowItems';
import { SpaceTab } from './SpaceTab';
import { SpaceOverflowMenu } from './SpaceOverflowMenu';
import type { Space } from '@/types';

export function SpaceTabs() {
  const spaces           = useAppStore((s) => s.spaces);
  const activeSpaceId    = useAppStore((s) => s.activeSpaceId);
  const setActiveSpace   = useAppStore((s) => s.setActiveSpace);
  const loadBoard        = useAppStore((s) => s.loadBoard);
  const openSpaceModal   = useAppStore((s) => s.openSpaceModal);
  const openDeleteDialog = useAppStore((s) => s.openDeleteSpaceDialog);
  const pinSpace         = useAppStore((s) => s.pinSpace);
  const unpinSpace       = useAppStore((s) => s.unpinSpace);
  const reorderPinned    = useAppStore((s) => s.reorderPinnedSpaces);

  // ---------------------------------------------------------------------------
  // Ordering: pinned spaces always come first, in the order they were pinned
  // (pinnedRank). Non-pinned keep their existing relative order (stable sort).
  // The width-based overflow then naturally keeps the pinned ones as visible tabs.
  // ---------------------------------------------------------------------------
  const orderedSpaces = [...spaces].sort((a, b) => {
    const ap = a.pinned ? 0 : 1;
    const bp = b.pinned ? 0 : 1;
    if (ap !== bp) return ap - bp;
    if (a.pinned && b.pinned) return (a.pinnedRank ?? 0) - (b.pinnedRank ?? 0);
    return 0;
  });

  // ---------------------------------------------------------------------------
  // Overflow measurement
  // ---------------------------------------------------------------------------
  // Forced-visible = the active space + every pinned space. Pinned tabs must win
  // the visible slots over non-pinned ones (otherwise a short non-pinned space
  // like "General" can take a slot while a pinned space sits in overflow).
  const forcedVisibleIds = orderedSpaces
    .filter((s) => s.pinned || s.id === activeSpaceId)
    .map((s) => s.id);

  // The set of pinned spaces drives whether tabs show a pin icon — i.e. their
  // rendered width. Feed it as measureKey so pin/unpin forces a fresh measure
  // pass (same ids, different widths) instead of computing with stale widths.
  const pinnedSetKey = orderedSpaces.filter((s) => s.pinned).map((s) => s.id).join('\0');

  const { containerRef, setItemRef, visible, overflow, measuring } =
    useOverflowItems<Space>(orderedSpaces, {
      pinnedIds: forcedVisibleIds,
      activeId: activeSpaceId ?? undefined,
      measureKey: pinnedSetKey,
      // 122 = nav px-4 padding (32) + overflowBtn "N ⌄" (~44) + divider (~9) + addBtn (~28) + gaps (~7) + 2px safety
      reservedTrailingPx: 122,
      gapPx: 2,
    });

  // ---------------------------------------------------------------------------
  // Pinned drag-and-drop reorder state (QOL-2)
  // ---------------------------------------------------------------------------
  const pinnedOrder = orderedSpaces.filter((s) => s.pinned).map((s) => s.id);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function resetDrag() {
    setDragId(null);
    setDragOverId(null);
  }

  function handleDragStart(e: React.DragEvent, spaceId: string) {
    setDragId(spaceId);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox to initiate the drag.
    e.dataTransfer.setData('text/plain', spaceId);
  }

  function handleDragOver(e: React.DragEvent, spaceId: string) {
    if (!dragId) return;
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = 'move';
    if (spaceId !== dragOverId) setDragOverId(spaceId);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const from = pinnedOrder.indexOf(dragId ?? '');
    const to = pinnedOrder.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) {
      resetDrag();
      return;
    }
    const next = [...pinnedOrder];
    next.splice(from, 1);
    next.splice(to, 0, dragId!);
    reorderPinned(next);
    resetDrag();
  }

  // ---------------------------------------------------------------------------
  // Kebab / context menu state
  // ---------------------------------------------------------------------------
  const [menuState, setMenuState] = useState<{
    open: boolean;
    spaceId: string;
    anchorRect: DOMRect | null;
  }>({ open: false, spaceId: '', anchorRect: null });

  function handleTabClick(space: Space) {
    if (space.id === activeSpaceId) return;
    setActiveSpace(space.id);
    loadBoard();
  }

  function handleKebabClick(e: React.MouseEvent, spaceId: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuState({ open: true, spaceId, anchorRect: rect });
  }

  function handleMenuSelect(itemId: string) {
    const { spaceId } = menuState;
    if (itemId === 'rename') {
      const space = spaces.find((s) => s.id === spaceId);
      if (space) openSpaceModal('rename', space);
    } else if (itemId === 'delete') {
      openDeleteDialog(spaceId);
    } else if (itemId === 'pin') {
      pinSpace(spaceId);
    } else if (itemId === 'unpin') {
      unpinSpace(spaceId);
    }
  }

  function handleOverflowSelect(spaceId: string) {
    if (spaceId === activeSpaceId) return;
    setActiveSpace(spaceId);
    loadBoard();
  }

  const isLastSpace = spaces.length <= 1;
  const isTargetPinned = (spaces.find((s) => s.id === menuState.spaceId)?.pinned) ?? false;
  const menuItems = [
    { id: 'rename', label: 'Edit', icon: 'edit' },
    { id: isTargetPinned ? 'unpin' : 'pin', label: isTargetPinned ? 'Unpin' : 'Pin', icon: 'push_pin' },
    { id: 'delete', label: 'Delete', icon: 'delete', danger: true, disabled: isLastSpace },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // During the measure pass, render all tabs invisible so the hook can read widths.
  // After measurement, render only the visible set.
  const tabsToRender: Space[] = measuring ? orderedSpaces : visible;

  return (
    <nav
      ref={containerRef as React.RefCallback<HTMLElement>}
      className="flex items-center gap-1 border-b border-border bg-surface-elevated px-4 overflow-hidden"
      role="tablist"
      aria-label="Spaces"
    >
      {/* Tab strip — invisible during measure pass to prevent flash */}
      <div
        className={[
          // NOT flex-1: the strip is content-width so the trailing buttons (+N / +)
          // sit immediately after the last tab instead of being pushed to the far
          // right edge with a gap. min-w-0 lets it still yield width to the
          // shrink-0 buttons in the rare overshoot (force-pin) so the + is never
          // clipped past the nav's overflow-hidden edge.
          'flex items-center min-w-0 gap-1 py-1.5',
          measuring ? 'invisible' : '',
        ].join(' ')}
      >
        {tabsToRender.map((space) => (
          <SpaceTab
            key={space.id}
            space={space}
            active={space.id === activeSpaceId}
            onSelect={handleTabClick}
            onKebab={handleKebabClick}
            refCb={setItemRef(space.id)}
            // Only pinned tabs are draggable, and they reorder within the pinned block.
            draggable={!!space.pinned}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={resetDrag}
            isDragging={dragId === space.id}
            isDragOver={dragOverId === space.id && dragId !== space.id}
          />
        ))}
      </div>

      {/* Overflow button (+N) — only shown after measurement and when there is overflow */}
      {!measuring && overflow.length > 0 && (
        <SpaceOverflowMenu
          spaces={overflow}
          activeSpaceId={activeSpaceId ?? ''}
          onSelect={handleOverflowSelect}
          onUnpin={unpinSpace}
          filterThreshold={6}
        />
      )}

      {/* Divider — separates space navigation (tabs + overflow) from the create action */}
      <span className="w-px h-5 bg-border mx-1 flex-shrink-0" aria-hidden="true" />

      {/* Add space button */}
      <button
        id="space-add-btn"
        aria-label="Create new space"
        title="Create new space"
        onClick={() => openSpaceModal('create')}
        className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary active:scale-90 transition-[color,background-color,transform] duration-fast flex-shrink-0"
      >
        <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
          add
        </span>
      </button>

      {/* Context menu (portal) — for Edit / Delete from kebab */}
      <ContextMenu
        open={menuState.open}
        anchorRect={menuState.anchorRect}
        items={menuItems}
        onSelect={handleMenuSelect}
        onClose={() => setMenuState((s) => ({ ...s, open: false }))}
      />
    </nav>
  );
}
