/**
 * SpaceTabs — space tab bar with explicit pin model + responsive overflow.
 *
 * Architecture (ADR-1, QOL-2 space-pins):
 *   - Pinned spaces occupy a fixed visible zone on the left (always rendered,
 *     drag-reorderable).
 *   - Non-pinned spaces fill the remaining window width as tabs; only the ones
 *     that do NOT fit collapse into the "More spaces (N)" overflow menu. With few
 *     spaces they are all visible — the menu appears only on real overflow, and
 *     the split re-computes as the window resizes (useOverflowItems).
 *   - The active space is forced visible (useOverflowItems `pinnedId`) so the
 *     current space is always anchored even when it would otherwise overflow.
 *   - Drag-to-reorder within the pinned zone uses local state (dragSourceIdx /
 *     dragOverIdx) — not useDragStore (which models task card semantics).
 *   - Pin / Unpin exposed from the kebab context menu on each tab.
 */

import React, { useState } from 'react';
import { ContextMenu } from '@/components/shared/ContextMenu';
import { useAppStore } from '@/stores/useAppStore';
import { useOverflowItems } from '@/hooks/useOverflowItems';
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

  // Responsive split of the non-pinned spaces by available width. The active
  // space is forced visible so it is never hidden in the overflow menu.
  const { containerRef, setItemRef, visible, overflow, measuring } =
    useOverflowItems(nonPinned, { pinnedId: activeSpaceId ?? undefined, reservedTrailingPx: 150 });

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

  // A non-pinned tab — shared by the measuring pass and the real render.
  const renderTab = (space: Space) => (
    <SpaceTab
      key={space.id}
      space={space}
      active={space.id === activeSpaceId}
      onSelect={handleTabClick}
      onKebab={handleKebabClick}
    />
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <nav
      className="flex items-center gap-1 border-b border-border bg-surface-elevated px-4 overflow-hidden"
      role="tablist"
      aria-label="Spaces"
    >
      {/* Pinned zone — always rendered, drag-reorderable. Scrolls within a bounded
          width when narrow so the overflow + add buttons stay visible. */}
      {pinnedSpaces.length > 0 && (
        <div className="flex items-center gap-0.5 py-1.5 overflow-x-auto scrollbar-hidden min-w-0 max-w-[60%]">
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

      {/* Divider — only when the pinned zone and at least one non-pinned tab coexist */}
      {pinnedSpaces.length > 0 && nonPinned.length > 0 && (
        <div className="w-px h-5 bg-border mx-1 flex-shrink-0" aria-hidden="true" />
      )}

      {/* Non-pinned zone — fills remaining width; the tabs that fit render here */}
      <div
        ref={containerRef}
        className="flex items-center gap-0.5 py-1.5 min-w-0 flex-1 overflow-hidden"
      >
        {measuring
          // Measuring pass: render all candidates (hidden) so the hook can read
          // their widths. Settles before paint (useLayoutEffect) — no flicker.
          ? nonPinned.map((space) => (
              <div key={space.id} ref={setItemRef(space.id)} className="invisible" aria-hidden="true">
                {renderTab(space)}
              </div>
            ))
          : visible.map(renderTab)}
      </div>

      {/* Overflow menu — a sibling OUTSIDE the clipped zone so its label is never
          truncated; it lives in the width reserved by useOverflowItems. */}
      {!measuring && overflow.length > 0 && (
        <SpaceOverflowMenu
          spaces={overflow}
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
