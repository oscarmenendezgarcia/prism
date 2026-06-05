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

  // ---------------------------------------------------------------------------
  // Overflow measurement
  // ---------------------------------------------------------------------------
  const { containerRef, setItemRef, visible, overflow, measuring } =
    useOverflowItems<Space>(spaces, {
      pinnedId: activeSpaceId ?? undefined,
      // 112 = nav px-4 padding (32) + overflowBtn (~42) + addBtn (~28) + 2 gaps (~8) + 2px safety
      reservedTrailingPx: 112,
      gapPx: 2,
    });

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
    }
  }

  function handleOverflowSelect(spaceId: string) {
    if (spaceId === activeSpaceId) return;
    setActiveSpace(spaceId);
    loadBoard();
  }

  const isLastSpace = spaces.length <= 1;
  const menuItems = [
    { id: 'rename', label: 'Edit',   icon: 'edit' },
    { id: 'delete', label: 'Delete', icon: 'delete', danger: true, disabled: isLastSpace },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // During the measure pass, render all tabs invisible so the hook can read widths.
  // After measurement, render only the visible set.
  const tabsToRender: Space[] = measuring ? spaces : visible;

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
          'flex items-center min-w-0 gap-0.5 py-1.5',
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
          />
        ))}
      </div>

      {/* Overflow button (+N) — only shown after measurement and when there is overflow */}
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
