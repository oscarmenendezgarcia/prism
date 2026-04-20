/**
 * LogViewer — scrollable log content area for the Pipeline Log panel.
 * ADR-1 (log-viewer) §3.4: renders a <pre> with auto-scroll to bottom.
 * Auto-scroll is disabled when the user has manually scrolled up.
 * Shows a "Scroll to bottom" button when detached.
 *
 * Empty states:
 *  - isPending + empty content → "Stage not started yet."
 *  - isRunning + empty content → spinner + "Waiting for output..."
 *  - error !== null           → error message in error color
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';

export interface LogViewerProps {
  /** Raw log text to display. */
  content: string;
  /** True when the stage status is 'pending' (has not started). */
  isPending: boolean;
  /** True when the stage status is 'running' (started but may have no output yet). */
  isRunning: boolean;
  /** True while a fetch is in-flight for this stage. */
  isLoading: boolean;
  /** Error message to display, or null when there is no error. */
  error: string | null;
}

/** Threshold in px: if the user scrolls more than this from the bottom, auto-scroll stops. */
const AT_BOTTOM_THRESHOLD = 8;

/**
 * Displays pipeline stage log output with auto-scroll and empty-state handling.
 */
export function LogViewer({
  content,
  isPending,
  isRunning,
  isLoading,
  error,
}: LogViewerProps) {
  const containerRef = useRef<HTMLPreElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Track whether the user has scrolled away from the bottom.
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distanceFromBottom <= AT_BOTTOM_THRESHOLD);
  }, []);

  // Auto-scroll on content update when pinned to bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isAtBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [content, isAtBottom]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
  }, []);

  // --- Error state ---
  if (error !== null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center min-h-0">
        <span
          className="material-symbols-outlined text-3xl text-error leading-none"
          aria-hidden="true"
        >
          error
        </span>
        <p className="text-xs text-error font-medium">No se pudo cargar el log.</p>
        <p className="text-xs text-text-secondary">El servidor no respondió. Se reintentará automáticamente.</p>
      </div>
    );
  }

  // --- Empty content states ---
  if (!content) {
    if (isPending) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center min-h-0">
          <span
            className="material-symbols-outlined text-3xl text-text-disabled leading-none"
            aria-hidden="true"
          >
            hourglass_empty
          </span>
          <p className="text-xs text-text-secondary">Stage not started yet.</p>
        </div>
      );
    }

    if (isRunning || isLoading) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center min-h-0">
          <span
            className="material-symbols-outlined text-3xl text-primary leading-none animate-spin"
            aria-hidden="true"
          >
            progress_activity
          </span>
          <p className="text-xs text-text-secondary">Waiting for output...</p>
        </div>
      );
    }

    // Completed but empty (e.g. stage produced no output).
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center min-h-0">
        <span
          className="material-symbols-outlined text-3xl text-text-disabled leading-none"
          aria-hidden="true"
        >
          article
        </span>
        <p className="text-xs text-text-secondary">No output for this stage.</p>
      </div>
    );
  }

  // --- Log content ---
  return (
    <div className="flex-1 relative flex flex-col min-h-0">
      <pre
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 text-xs font-mono text-terminal-text whitespace-pre-wrap break-words bg-terminal-bg min-h-0"
        aria-label="Stage log output"
        aria-live="polite"
        aria-atomic="false"
      >
        {content}
      </pre>

      {/* Scroll-to-bottom button — visible when user has scrolled up */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          className="absolute bottom-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-white text-xs font-medium shadow-md hover:bg-primary-hover transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
            keyboard_arrow_down
          </span>
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
