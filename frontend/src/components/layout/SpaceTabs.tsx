/**
 * Space tab bar — renders one tab per space, active state, kebab menu, and add-space button.
 * ADR-002: replaces the #space-tabs-list DOM manipulation in legacy spaces.js.
 * ADR-003 §8.2: glass-surface background, transition-opacity on kebab icon.
 */

import React, { useState } from 'react';
import { ContextMenu } from '@/components/shared/ContextMenu';
import { useAppStore } from '@/stores/useAppStore';
import type { Space } from '@/types';

export function SpaceTabs() {
  const spaces          = useAppStore((s) => s.spaces);
  const activeSpaceId   = useAppStore((s) => s.activeSpaceId);
  const setActiveSpace  = useAppStore((s) => s.setActiveSpace);
  const loadBoard       = useAppStore((s) => s.loadBoard);
  const openSpaceModal  = useAppStore((s) => s.openSpaceModal);
  const openDeleteDialog = useAppStore((s) => s.openDeleteSpaceDialog);

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

  const isLastSpace = spaces.length <= 1;

  const menuItems = [
    { id: 'rename', label: 'Edit', icon: 'edit' },
    { id: 'delete', label: 'Delete', icon: 'delete', danger: true, disabled: isLastSpace },
  ];

  return (
    <nav
      className="flex items-center gap-0 border-b border-border bg-surface-elevated glass-surface px-4 overflow-x-auto"
      role="tablist"
      aria-label="Spaces"
    >
      {/* Tab list */}
      <div className="flex items-center flex-1 gap-0.5 py-1">
        {spaces.map((space) => {
          const isActive = space.id === activeSpaceId;
          return (
            <button
              key={space.id}
              role="tab"
              aria-selected={isActive}
              data-space-id={space.id}
              onClick={() => handleTabClick(space)}
              className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-200 ease-apple rounded-md ${
                isActive
                  ? 'bg-primary/10 text-primary border-b-2 border-primary rounded-b-none -mb-1 pb-2.5'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
              }`}
            >
              <span className="space-tab-name">{space.name}</span>

              {/* Kebab icon */}
              <span
                role="button"
                aria-label="Space options"
                title="Space options"
                onClick={(e) => handleKebabClick(e, space.id)}
                className={`material-symbols-outlined text-base leading-none text-text-secondary hover:text-text-primary transition-opacity duration-150 rounded ${
                  isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                more_vert
              </span>
            </button>
          );
        })}
      </div>

      {/* Add space button */}
      <button
        id="space-add-btn"
        aria-label="Create new space"
        title="Create new space"
        onClick={() => openSpaceModal('create')}
        className="flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-variant hover:text-primary transition-all duration-150"
      >
        <span className="material-symbols-outlined text-xl leading-none" aria-hidden="true">
          add
        </span>
      </button>

      {/* Context menu (portal) */}
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
