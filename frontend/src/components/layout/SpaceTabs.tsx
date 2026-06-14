/**
 * SpaceTabs — space tab bar with explicit pin model.
 *
 * Architecture (ADR-1, QOL-2 space-pins):
 *   - Pinned spaces occupy a fixed visible zone on the left (always rendered).
 *   - Non-pinned spaces collapse into a single overflow menu ("Más spaces (N)").
 *   - If the active space is not pinned, it renders as a transient tab after the
 *     pinned zone so the user always has a visual anchor for the current space.
 *   - Drag-to-reorder within the pinned zone uses local state (dragSourceIdx /
 *     dragOverIdx) — not useDragStore (which models task card semantics).
 *   - Pin / Unpin exposed from the kebab context menu on each tab.
 *
 * useOverflowItems is no longer used here (preserved in the codebase for other
 * potential consumers). See ADR-1 §T1 for the trade-off rationale.
 */

import React, { useState } from 'react';
import { ContextMenu } from '@/components/shared/ContextMenu';
import { useAppStore } from '@/stores/useAppStore';
import { SpaceTab } from './SpaceTab';
import { SpaceOverflowMenu } from './SpaceOverflowMenu';
import type { Space } from '@/types';

export function SpaceTabs() {
  const spaces             = useAppStore((s) => s.spaces);
  const activeSpaceId      = useAppStore((s) => s.activeSpaceId);
  const setActiveSpace     = useAppStore((s) => s.setActiveSpace);
  const loadBoard          = useAppStore((s) => s.loadBoard);
  const openSpaceModal     = useAppStore((s) => s.openSpaceModal);
  const openDeleteDialog   = useAppStore((s) => s.openDeleteSpaceDialog);
  const pinSpace           = useAppStore((s) => s.pinSpace);
  const unpinSpace         = useAppStore((s) => s.unpinSpace);
  const reorderPinnedSpaces = useAppStore((s) => s.reorderPinnedSpaces);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const pinnedSpaces = spaces
    .filter((s) => s.pinned)
    .sort((a, b) => (a.pinnedRank ?? 0) - (b.pinnedRank ?? 0));

  const nonPinned = spaces.filter((s) => !s.pinned);

  // The active space rendered as a transient tab after the pinned zone (only
  // when it is not already in the pinned zone).
  const activeNotPinned: Space | null =
    activeSpaceId && !pinnedSpaces.some((s) => s.id === activeSpaceId)
      ? spaces.find((s) => s.id === activeSpaceId) ?? null
      : null;

  // Overflow: all non-pinned spaces except the transient active tab.
  const overflowSpaces = activeNotPinned
    ? nonPinned.filter((s) => s.id !== activeSpaceId)
    : nonPinned;

  // ---------------------------------------------------------------------------
  // Drag reorder (local state — QOL-2, local component state, not useDragStore)
  // ---------------------------------------------------------------------------
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx]     = useState<number | null>(null);

  function handleDrop(targetIdx: number) {
    if (dragSourceIdx === null || dragSourceIdx === targetIdx) return;
    const reordered = [...pinnedSpaces];
    const [moved] = reordered.splice(dragSourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    reorderPinnedSpaces(reordered.map((s) => s.id));
    setDragSourceIdx(null);
    setDragOverIdx(null);
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

  // Build context menu items dynamically based on the target space's pin state.
  const menuTargetSpace = spaces.find((s) => s.id === menuState.spaceId);
  const isMenuTargetPinned = menuTargetSpace?.pinned ?? false;

  const menuItems = [
    { id: 'rename',                 label: 'Edit',                          icon: 'edit' },
    { id: isMenuTargetPinned ? 'unpin' : 'pin',
      label: isMenuTargetPinned ? 'Unpin' : 'Pin',
      icon: 'push_pin' },
    { id: 'delete', label: 'Delete', icon: 'delete', danger: true, disabled: isLastSpace },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <nav
      className="flex items-center gap-1 border-b border-border bg-surface-elevated px-4 overflow-hidden"
      role="tablist"
      aria-label="Spaces"
    >
      {/* Pinned zone — always visible, drag-reorderable */}
      {pinnedSpaces.length > 0 && (
        <div className="flex items-center gap-0.5 py-1.5 overflow-x-auto scrollbar-hidden flex-shrink-0">
          {pinnedSpaces.map((space, idx) => (
            <SpaceTab
              key={space.id}
              space={space}
              active={space.id === activeSpaceId}
              pinned
              draggable
              dragOver={dragOverIdx === idx}
              onSelect={handleTabClick}
              onKebab={handleKebabClick}
              onDragStart={() => setDragSourceIdx(idx)}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragSourceIdx(null); setDragOverIdx(null); }}
            />
          ))}
        </div>
      )}

      {/* Divider — only shown when both zones have content */}
      {pinnedSpaces.length > 0 && (overflowSpaces.length > 0 || activeNotPinned) && (
        <div className="w-px h-5 bg-border mx-1 flex-shrink-0" aria-hidden="true" />
      )}

      {/* Transient active tab — shown when the active space is not pinned */}
      {activeNotPinned && (
        <div className="flex items-center gap-0.5 py-1.5 flex-shrink-0">
          <SpaceTab
            key={activeNotPinned.id}
            space={activeNotPinned}
            active
            onSelect={handleTabClick}
            onKebab={handleKebabClick}
          />
        </div>
      )}

      {/* Overflow: all non-pinned spaces (minus the transient active) */}
      {overflowSpaces.length > 0 && (
        <SpaceOverflowMenu
          spaces={overflowSpaces}
          activeSpaceId={activeSpaceId ?? ''}
          onSelect={handleOverflowSelect}
          filterThreshold={6}
        />
      )}

      {/* Add space button */}
      <button
        id="space-add-btn"
        aria-label="Create new space"
        title="Create new space"
        onClick={() => openSpaceModal('create')}
        className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary transition-all duration-fast flex-shrink-0"
      >
        <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
          add
        </span>
      </button>

      {/* Context menu (portal) — for Edit / Pin-Unpin / Delete from kebab */}
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
