/**
 * ArcAutocomplete — controlled combobox for the `arc` field.
 * Existing arc labels are passed in via `arcs` (derived from the loaded tasks).
 * Accepts free-text input (user can create a new arc label not in the list).
 * Keyboard: ArrowDown/Up to navigate, Enter to select, Escape to close dropdown.
 *
 * The dropdown is rendered in a portal anchored to the input's rect (same pattern
 * as Modal/ContextMenu) so it escapes the TaskDetailPanel's scroll container and
 * positioned siblings — otherwise an `absolute` listbox gets clipped / trapped
 * under later sections and its options can't be clicked.
 */

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

interface ArcAutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  /** Existing arc labels to suggest (e.g. derived from the space's tasks). */
  arcs: string[];
  placeholder?: string;
  className?: string;
  /** Override the input styling so it matches the host form (modal vs panel). */
  inputClassName?: string;
}

/** Default input style — matches the create-task modal's field look. */
const DEFAULT_INPUT_CLASS =
  'w-full px-3 py-2 border border-border rounded-md text-sm text-text-primary bg-surface-variant placeholder:text-text-disabled ' +
  'focus:outline-hidden focus:border-primary focus:ring-2 focus:ring-primary/40 transition-colors duration-150 h-12';

export function ArcAutocomplete({
  value,
  onChange,
  arcs,
  placeholder = 'Search or create an arc…',
  className,
  inputClassName,
}: ArcAutocompleteProps) {
  const [open, setOpen]               = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [rect, setRect]               = useState<{ left: number; top: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const listboxRef   = useRef<HTMLUListElement>(null);

  const filtered = arcs.filter((o) =>
    o.toLowerCase().includes(value.toLowerCase())
  );
  const showList = open && filtered.length > 0;

  // Anchor the portal listbox to the input. Recompute while open so it tracks
  // scrolling/resizing of any ancestor; close-on-blur is handled separately.
  useLayoutEffect(() => {
    if (!showList) return;
    const measure = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [showList]);

  // Keep the keyboard-highlighted option scrolled into view within the listbox.
  useEffect(() => {
    if (!showList || highlighted < 0) return;
    const el = listboxRef.current?.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted, showList]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || listboxRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && e.key === 'ArrowDown') {
      setOpen(true);
      setHighlighted(0);
      return;
    }
    if (e.key === 'ArrowDown') {
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) {
        onChange(filtered[highlighted]);
        setOpen(false);
        setHighlighted(-1);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  // pr-8 always reserves room for the clear button, regardless of host styling.
  const inputClass = `${inputClassName ?? DEFAULT_INPUT_CLASS} pr-8`;

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls="arc-autocomplete-listbox"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlighted(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={inputClass}
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear arc"
            onClick={() => { onChange(''); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-sm leading-none">close</span>
          </button>
        )}
      </div>

      {showList && createPortal(
        <ul
          ref={listboxRef}
          id="arc-autocomplete-listbox"
          role="listbox"
          className="fixed z-[120] bg-surface-elevated border border-border rounded-md shadow-lg max-h-48 overflow-y-auto"
          style={rect ? { left: rect.left, top: rect.top, width: rect.width } : { visibility: 'hidden' }}
        >
          {filtered.map((opt, i) => (
            <li
              key={opt}
              role="option"
              aria-selected={value === opt}
              className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                i === highlighted ? 'bg-primary/10 text-primary' : 'text-text-primary hover:bg-primary/10'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setOpen(false);
                setHighlighted(-1);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              {opt}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
