/**
 * ArcAutocomplete — controlled combobox for the `arc` field.
 * Fetches existing arc values from GET /spaces/:spaceId/arcs on mount.
 * Accepts free-text input (user can create a new arc label not in the list).
 * Keyboard: ArrowDown/Up to navigate, Enter to select, Escape to close dropdown.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '@/api/client';

interface ArcAutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  spaceId: string;
  placeholder?: string;
  className?: string;
}

export function ArcAutocomplete({
  value,
  onChange,
  spaceId,
  placeholder = 'e.g. QOL, AUTH, LOOP',
  className,
}: ArcAutocompleteProps) {
  const [options, setOptions]         = useState<string[]>([]);
  const [open, setOpen]               = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!spaceId) return;
    api.getArcs(spaceId)
      .then((data) => setOptions(data.arcs))
      .catch(() => setOptions([]));
  }, [spaceId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(value.toLowerCase())
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
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
  }, [open, filtered, highlighted, onChange]);

  const inputClass =
    'w-full px-3 py-2 border border-border rounded-md text-sm text-text-primary bg-surface-variant placeholder:text-text-disabled ' +
    'focus:outline-hidden focus:border-primary focus:ring-2 focus:ring-primary/40 transition-colors duration-150 h-12 pr-8';

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

      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface-elevated border border-border rounded-md shadow-md max-h-48 overflow-y-auto"
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
        </ul>
      )}
    </div>
  );
}
