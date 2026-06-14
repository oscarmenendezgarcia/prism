/**
 * SpaceTab — renders a single space tab with:
 *   - Truncated label (max-w-[160px] + CSS truncate)
 *   - Hover tooltip with full name (only rendered when text is actually truncated)
 *   - Active state: filled chip (bg-primary-container) + font-medium
 *   - Inactive state: text-text-secondary, hover reveal of bg-surface-variant + kebab
 *   - Kebab affordance: persistent at opacity-70 on active, hover-reveal on inactive
 *   - Accessibility: role="tab", aria-selected, data-space-id, title, focus-visible ring
 *
 * QOL-2 additions:
 *   - Optional `pinned` prop: shows push_pin icon affordance
 *   - Optional drag props: draggable, dragOver, onDragStart, onDragOver, onDrop, onDragEnd
 *
 * ADR-1 (space-tabs-overflow): extracted from SpaceTabs for single-responsibility
 * and to expose a refCb for the useOverflowItems measurement hook.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import type { Space } from '@/types';

export interface SpaceTabProps {
  space: Space;
  active: boolean;
  onSelect: (space: Space) => void;
  onKebab: (e: React.MouseEvent, spaceId: string) => void;
  /** ref callback forwarded from useOverflowItems for width measurement */
  refCb?: (el: HTMLElement | null) => void;
  // ── QOL-2: drag-reorder + pin indicator ─────────────────────────────────
  /** When true, renders a push_pin icon to indicate the tab is in the pinned zone. */
  pinned?: boolean;
  /** When true, makes the tab draggable (HTML5 Drag API). */
  draggable?: boolean;
  /** When true, renders a drop-target ring to signal this tab is the drag-over target. */
  dragOver?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}

export function SpaceTab({
  space,
  active,
  onSelect,
  onKebab,
  refCb,
  pinned,
  draggable,
  dragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: SpaceTabProps) {
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  // Detect truncation after render — only mount tooltip bubble if needed
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (el) setShowTooltip(el.scrollWidth > el.offsetWidth);
  });

  function handleKebabClick(e: React.MouseEvent) {
    e.stopPropagation();
    onKebab(e, space.id);
  }

  // The tab is a <div role="tab"> (not a <button>) because it nests an
  // interactive kebab <button>, and nesting interactive elements is invalid
  // HTML. role="tab" + tabIndex + key handling restore native button semantics.
  // Guard on target === currentTarget so Enter/Space on the kebab don't also
  // fire onSelect (the keydown bubbles up from the inner button otherwise).
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(space);
    }
  }

  return (
    <div
      ref={refCb}
      role="tab"
      tabIndex={0}
      aria-selected={active}
      data-space-id={space.id}
      title={space.name}
      draggable={draggable ?? false}
      onClick={() => onSelect(space)}
      onKeyDown={handleKeyDown}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-label={space.name}
      className={[
        // Base layout
        'group relative flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md',
        'transition-all duration-fast select-none whitespace-nowrap flex-shrink-0',
        // Drag cursor when draggable
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        // Focus ring
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        // Drop-target ring
        dragOver ? 'ring-2 ring-primary ring-inset' : '',
        // Active vs inactive styling
        active
          ? 'bg-primary-container text-primary font-medium'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant',
      ].join(' ')}
    >
      {/* Pin indicator — visual only, not interactive */}
      {pinned && (
        <span
          className="material-symbols-outlined text-xs leading-none opacity-30 flex-shrink-0"
          aria-hidden="true"
        >
          push_pin
        </span>
      )}

      {/* Truncated label — aria-label is on the outer button; no duplicate needed here */}
      <span
        ref={labelRef}
        className="max-w-[160px] truncate"
      >
        {space.name}
      </span>

      {/* Hover tooltip — only mounted when text is actually truncated */}
      {showTooltip && (
        <span
          role="tooltip"
          className={[
            // Positioning: above the tab (tabs are at the top, so tooltip goes below)
            'absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[300]',
            'pointer-events-none whitespace-nowrap',
            // Visual
            'px-2.5 py-1 text-xs font-semibold text-text-primary',
            'bg-surface-elevated border border-border rounded-md shadow-md',
            // Animate in on hover — uses the button's group hover
            'opacity-0 translate-y-1',
            'group-hover:opacity-100 group-hover:translate-y-0',
            'transition-all duration-fast',
            '[transition-delay:400ms]',
          ].join(' ')}
        >
          {space.name}
        </span>
      )}

      {/* Kebab affordance — real button for native keyboard focus (WCAG 2.1 SC 2.1.1) */}
      <button
        type="button"
        aria-label="Space options"
        title="Space options"
        onClick={handleKebabClick}
        className={[
          'material-symbols-outlined text-base leading-none text-text-secondary',
          'hover:text-text-primary transition-opacity duration-fast rounded',
          active ? 'opacity-70' : 'opacity-0 group-hover:opacity-100',
        ].join(' ')}
      >
        more_vert
      </button>
    </div>
  );
}
