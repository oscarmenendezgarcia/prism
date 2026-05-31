/**
 * ReferenceAutocomplete — [[ ]] folio reference autocomplete for task descriptions.
 *
 * Wraps a textarea and detects the [[ trigger. Shows a two-level dropdown:
 *   Level 1 — page search via /folio/refs/search (FTS)
 *   Level 2 — H2 section list via /folio/refs/sections when user types `[[slug#`
 *
 * Keyboard nav: ArrowUp / ArrowDown navigate, Enter selects, Escape closes.
 * Click outside closes.
 *
 * On select, inserts `[[chapter/page]]` or `[[chapter/page#section]]` and
 * positions the caret just after the closing `]]`.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { searchFolioRefs, getFolioRefSections } from '@/api/client';
import type { FolioRef, FolioSection } from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';

// ---------------------------------------------------------------------------
// useReferenceTrigger — detects [[ before the caret and extracts the token
// ---------------------------------------------------------------------------

interface TriggerState {
  /** True when [[ is active before the caret. */
  active: boolean;
  /**
   * Text typed after `[[` up to whitespace or EOF.
   * May include a `#` divider: "chapter/page#partial-section".
   */
  token: string;
  /** Index in the textarea value where `[[` starts. */
  triggerStart: number;
}

function useReferenceTrigger(
  value: string,
  selectionStart: number | null,
): TriggerState {
  if (selectionStart === null) return { active: false, token: '', triggerStart: -1 };

  // Walk backward from caret to find the most recent `[[`.
  const textBefore = value.slice(0, selectionStart);
  const bracketIdx = textBefore.lastIndexOf('[[');
  if (bracketIdx === -1) return { active: false, token: '', triggerStart: -1 };

  // Everything after `[[` up to the caret.
  const after = textBefore.slice(bracketIdx + 2);

  // Abort if the token contains whitespace or an already-closed `]]`.
  if (/[\s\]]/.test(after)) return { active: false, token: '', triggerStart: -1 };

  return { active: true, token: after, triggerStart: bracketIdx };
}

// ---------------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Dropdown item shapes
// ---------------------------------------------------------------------------

type DropdownItem =
  | { kind: 'ref';     ref:     FolioRef }
  | { kind: 'section'; section: FolioSection; pageSlug: string; chapterSlug: string };

// ---------------------------------------------------------------------------
// ReferenceAutocomplete props
// ---------------------------------------------------------------------------

export interface ReferenceAutocompleteProps {
  /** Current textarea value (controlled). */
  value: string;
  /** Called whenever the value changes (user typing or autocomplete insertion). */
  onChange: (value: string) => void;
  /**
   * All standard textarea props except value/onChange.
   * The Record<string, unknown> intersection allows data-* attributes (e.g. data-testid).
   */
  textareaProps?: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> &
    Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReferenceAutocomplete({
  value,
  onChange,
  textareaProps = {},
}: ReferenceAutocompleteProps) {
  const spaceId = useAppStore((s) => s.activeSpaceId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track caret position on every keyup / click / input
  const [selectionStart, setSelectionStart] = useState<number | null>(null);

  const updateCaret = useCallback(() => {
    setSelectionStart(textareaRef.current?.selectionStart ?? null);
  }, []);

  // Derive trigger state from current value + caret
  const trigger = useReferenceTrigger(value, selectionStart);

  // Split token into page-part and section-partial
  const hashIdx = trigger.token.indexOf('#');
  const pageToken    = hashIdx === -1 ? trigger.token : trigger.token.slice(0, hashIdx);
  const sectionToken = hashIdx === -1 ? null          : trigger.token.slice(hashIdx + 1);

  // Debounced search values
  const debouncedPageToken    = useDebounce(pageToken, 150);
  const debouncedSectionToken = useDebounce(sectionToken, 150);

  // Dropdown items
  const [items, setItems] = useState<DropdownItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Abort ref for fetch cancellation
  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch logic
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!trigger.active) {
      setItems([]);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    if (sectionToken !== null) {
      // Level 2: fetch sections for the resolved page slug
      if (!pageToken) {
        setItems([]);
        return;
      }

      setLoading(true);
      getFolioRefSections(spaceId, pageToken)
        .then((sections) => {
          const partial = (debouncedSectionToken ?? '').toLowerCase();
          const filtered = sections.filter((s) =>
            !partial || s.slug.includes(partial) || s.title.toLowerCase().includes(partial),
          );

          // Parse chapterSlug/pageSlug out of pageToken
          const slashIdx = pageToken.indexOf('/');
          const chapterSlug = slashIdx !== -1 ? pageToken.slice(0, slashIdx) : pageToken;
          const pgSlug      = slashIdx !== -1 ? pageToken.slice(slashIdx + 1) : '';

          setItems(filtered.map((section) => ({
            kind: 'section' as const,
            section,
            pageSlug:    pgSlug,
            chapterSlug,
          })));
          setActiveIdx(0);
        })
        .catch(() => { /* ignore aborted */ })
        .finally(() => setLoading(false));
    } else {
      // Level 1: page search
      setLoading(true);
      searchFolioRefs(spaceId, debouncedPageToken, 20)
        .then((refs) => {
          setItems(refs.map((ref) => ({ kind: 'ref' as const, ref })));
          setActiveIdx(0);
        })
        .catch(() => { /* ignore aborted */ })
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger.active, debouncedPageToken, debouncedSectionToken, spaceId]);

  // Reset active index when items change
  useEffect(() => setActiveIdx(0), [items.length]);

  // Close when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setItems([]);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ---------------------------------------------------------------------------
  // Insertion
  // ---------------------------------------------------------------------------

  const insertItem = useCallback(
    (item: DropdownItem) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      let insertion: string;
      if (item.kind === 'ref') {
        insertion = `${item.ref.slug}]]`;
      } else {
        insertion = `${item.chapterSlug}/${item.pageSlug}#${item.section.slug}]]`;
      }

      // Replace `[[<token>` with `[[<insertion>`
      const start  = trigger.triggerStart;
      const before = value.slice(0, start + 2);  // up to and including `[[`
      const after  = value.slice(start + 2 + trigger.token.length); // after the token

      const newValue   = before + insertion + after;
      const newCaretAt = start + 2 + insertion.length;

      onChange(newValue);
      setItems([]);

      // Restore caret after React re-renders the textarea
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newCaretAt, newCaretAt);
        setSelectionStart(newCaretAt);
      });
    },
    [value, onChange, trigger],
  );

  // ---------------------------------------------------------------------------
  // Keyboard handling
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!trigger.active || items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        insertItem(items[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setItems([]);
      }
    },
    [trigger.active, items, activeIdx, insertItem],
  );

  // ---------------------------------------------------------------------------
  // Dropdown label helpers
  // ---------------------------------------------------------------------------

  function itemLabel(item: DropdownItem): string {
    if (item.kind === 'ref')     return item.ref.title || item.ref.slug;
    if (item.kind === 'section') return item.section.title;
    return '';
  }

  function itemSubLabel(item: DropdownItem): string {
    if (item.kind === 'ref')     return item.ref.slug;
    if (item.kind === 'section') return `#${item.section.slug}`;
    return '';
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const showDropdown = trigger.active && (items.length > 0 || loading);

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setSelectionStart(e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={updateCaret}
        onClick={updateCaret}
        onFocus={updateCaret}
        {...textareaProps}
      />

      {showDropdown && (
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label="Folio reference suggestions"
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
        >
          {loading && items.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-secondary">Searching…</div>
          ) : (
            items.map((item, idx) => (
              <button
                key={idx}
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep textarea focus
                  insertItem(item);
                }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors duration-fast focus:outline-none ${
                  idx === activeIdx
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-primary hover:bg-surface-elevated'
                }`}
              >
                <span className="truncate font-medium">{itemLabel(item)}</span>
                <span className="truncate text-xs text-text-secondary">{itemSubLabel(item)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
