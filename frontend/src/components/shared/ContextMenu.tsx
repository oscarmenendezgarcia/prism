/**
 * Generic context menu rendered via createPortal.
 * Positions itself relative to the trigger element's viewport coordinates.
 * ADR-002 §5 rule 4: context menu uses portal with absolute positioning.
 * ADR-003 §8.8: glass-surface, rounded-lg, animate-scale-in.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  items: ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ContextMenu({ open, anchorRect, items, onSelect, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay so the click that opened the menu doesn't immediately close it
    const id = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', handler);
    };
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !anchorRect) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
    zIndex: 150,
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={style}
      className="bg-surface glass-surface border border-border rounded-lg shadow-md py-1 min-w-[160px] animate-scale-in"
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            onSelect(item.id);
          }}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors duration-150
            ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            ${item.danger && !item.disabled ? 'text-error hover:bg-error/[0.08]' : 'text-text-primary hover:bg-surface-variant'}
          `}
        >
          {item.icon && (
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
              {item.icon}
            </span>
          )}
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
