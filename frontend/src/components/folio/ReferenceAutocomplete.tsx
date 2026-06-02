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
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
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
// Caret pixel coordinates inside a textarea (mirror-div technique)
// ---------------------------------------------------------------------------

const MIRROR_PROPS = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily',
  'lineHeight', 'letterSpacing', 'textTransform', 'wordSpacing', 'textIndent',
  'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize',
] as const;

/**
 * Pixel offset (relative to the textarea's border box) of the caret at `pos`.
 * Renders a hidden mirror div with the textarea's text metrics and measures a
 * marker span. Returns { top, left, height }.
 */
function getCaretCoordinates(el: HTMLTextAreaElement, pos: number) {
  const computed = getComputedStyle(el);
  const div = document.createElement('div');
  const s = div.style;
  s.position = 'absolute';
  s.visibility = 'hidden';
  s.whiteSpace = 'pre-wrap';
  s.overflowWrap = 'break-word';
  const sAny = s as unknown as Record<string, string>;
  const cAny = computed as unknown as Record<string, string>;
  for (const prop of MIRROR_PROPS) {
    sAny[prop] = cAny[prop];
  }
  div.textContent = el.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = el.value.slice(pos) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const top    = span.offsetTop + parseInt(computed.borderTopWidth, 10);
  const left   = span.offsetLeft + parseInt(computed.borderLeftWidth, 10);
  const height = parseInt(computed.lineHeight, 10) || Math.round(parseInt(computed.fontSize, 10) * 1.4);
  document.body.removeChild(div);
  return { top, left, height };
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
  /**
   * Optional external ref to the underlying textarea, merged with the internal
   * one. Lets callers drive things like auto-grow (e.g. TaskDetailPanel).
   */
  inputRef?: React.Ref<HTMLTextAreaElement>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReferenceAutocomplete({
  value,
  onChange,
  textareaProps = {},
  inputRef,
}: ReferenceAutocompleteProps) {
  const spaceId = useAppStore((s) => s.activeSpaceId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Merge the internal ref with an optional external one (e.g. auto-grow).
  const setTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node;
    if (typeof inputRef === 'function') inputRef(node);
    else if (inputRef) (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
  }, [inputRef]);

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

  // Explicit dismissal (Escape / Enter-insert / click-outside). Clearing items
  // alone no longer hides the dropdown — the empty state keeps it open while a
  // token is typed (pageToken.length > 0) — so we need a flag that forces it
  // shut. It auto-resets when the trigger moves or toggles (the effect below),
  // i.e. when the user starts/edits a different reference.
  const [dismissed, setDismissed] = useState(false);

  // Re-arm the dropdown when the user starts or moves to a different reference:
  // a new `[[` position (triggerStart) or the trigger toggling active. Typing
  // more of the SAME dismissed token keeps it shut, which matches Escape UX.
  useEffect(() => {
    setDismissed(false);
  }, [trigger.triggerStart, trigger.active]);

  // Caret-anchored dropdown position (viewport-fixed, rendered in a portal so it
  // escapes any overflow:auto ancestor such as the modal body). Anchors by `top`
  // when there's room below the caret, or by `bottom` (just above the caret line)
  // when flipped up — so a 1-line empty state hugs the caret instead of floating high.
  const [coords, setCoords] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  // Highlight backdrop (renders the coloured [[refs]] behind the transparent textarea).
  const backdropRef = useRef<HTMLDivElement>(null);

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

  // Position the dropdown at the caret (viewport-fixed). Recompute on caret/value
  // change and on scroll/resize while the trigger is active.
  useEffect(() => {
    if (!trigger.active) { setCoords(null); return; }
    function compute() {
      const el = textareaRef.current;
      if (!el) return;
      const rect  = el.getBoundingClientRect();
      const caret = getCaretCoordinates(el, el.selectionStart ?? 0);
      const DROPDOWN_W = 320;
      const caretTop    = rect.top + caret.top - el.scrollTop;
      const caretBottom = caretTop + caret.height;
      let left = rect.left + caret.left - el.scrollLeft;
      left = Math.max(8, Math.min(left, window.innerWidth - DROPDOWN_W - 8));
      // Enough room below the caret? Anchor by top. Otherwise anchor the
      // dropdown's BOTTOM just above the caret line (grows upward, hugs the caret).
      const roomBelow = window.innerHeight - caretBottom;
      if (roomBelow >= 200 || roomBelow >= caretTop) {
        setCoords({ left, top: caretBottom + 4 });
      } else {
        setCoords({ left, bottom: window.innerHeight - caretTop + 4 });
      }
    }
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger.active, value, selectionStart, items.length]);

  // Close when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setDismissed(true);
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
      setDismissed(true);  // keep shut until the next [[ trigger (caret update is async via rAF)

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
      if (!trigger.active) return;

      // Escape works even on the empty state (no items), so it always dismisses.
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        setItems([]);
        return;
      }

      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        insertItem(items[activeIdx]);
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

  // Keep the textarea's text transparent (so the coloured backdrop shows through)
  // while restoring a visible caret, and keep the backdrop scrolled in sync.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const bd = backdropRef.current;
    if (!ta || !bd) return;
    // The backdrop carries the real text colour (via the shared className); reuse
    // it for the caret so the caret stays visible over the transparent text.
    ta.style.caretColor = getComputedStyle(bd).color;
    bd.scrollTop  = ta.scrollTop;
    bd.scrollLeft = ta.scrollLeft;
  });

  // Split the value into plain text and [[ref]] tokens for the highlight backdrop.
  function renderHighlighted(text: string) {
    const parts = text.split(/(\[\[[^\]]+?\]\])/g);
    return parts.map((part, i) =>
      /^\[\[[^\]]+?\]\]$/.test(part)
        ? <mark key={i} className="rounded-[3px] bg-primary/15 text-primary">{part}</mark>
        : <React.Fragment key={i}>{part}</React.Fragment>,
    );
    // Trailing newline: pre-wrap renders it; alignment matches the textarea.
  }

  const sharedClass = (textareaProps.className as string) ?? '';

  // Show once a search token exists (skip on a bare `[[`). Includes the empty
  // state so the dropdown never silently fails to appear.
  const showDropdown = trigger.active && coords !== null && !dismissed && (loading || items.length > 0 || pageToken.length > 0);

  return (
    <div className="relative w-full">
      {/* Highlight backdrop — shares the textarea's className (so metrics align) but
          with a transparent border so only the textarea's focus-aware border shows.
          Renders [[refs]] in the primary accent behind the transparent textarea. */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words ${sharedClass}`}
        style={{ borderColor: 'transparent' }} // lint-ok: hide the backdrop border so only the textarea's focus-aware border renders
      >
        {renderHighlighted(value)}
      </div>
      <textarea
        ref={setTextareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setSelectionStart(e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={updateCaret}
        onClick={updateCaret}
        onFocus={updateCaret}
        onScroll={(e) => {
          const bd = backdropRef.current;
          if (bd) { bd.scrollTop = e.currentTarget.scrollTop; bd.scrollLeft = e.currentTarget.scrollLeft; }
        }}
        {...textareaProps}
        style={{ ...(textareaProps.style as React.CSSProperties | undefined), position: 'relative', background: 'transparent', color: 'transparent' }} // lint-ok: overlay — transparent textarea bg/text reveals the highlight backdrop; caret colour restored in a layout effect
      />

      {showDropdown && coords && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label="Folio reference suggestions"
          style={{ position: 'fixed', left: coords.left, top: coords.top, bottom: coords.bottom, width: 320 }} // lint-ok: runtime caret-anchored position — Tailwind cannot express dynamic coordinates
          className="z-[200] max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
        >
          {loading && items.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-secondary">Searching…</div>
          ) : items.length === 0 ? (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-primary">
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">search_off</span>
              No matching folio pages
            </div>
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
        </div>,
        document.body,
      )}
    </div>
  );
}
