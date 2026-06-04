/**
 * FolioScreen — top-level Folio view orchestrator (T-005/T-006/T-007: folio-index-ui)
 *
 * Manages view state transitions:
 *   chapters → pages → page (editor)
 *
 * Reacts to space changes: when activeSpaceId changes in useAppStore,
 * resets the store and reloads the index.
 *
 * Vocabulary: Folio / Chapter / Page (neutral, no code context).
 */

import React, { useEffect, useRef, useState } from 'react';
import { useFolioStore } from '@/stores/useFolioStore';
import { useAppStore } from '@/stores/useAppStore';
import { FolioChapterList } from './FolioChapterList';
import { FolioPageList }    from './FolioPageList';
import { FolioPageEditor }  from './FolioPageEditor';
import { NewPageModal }     from './NewPageModal';
import { ApiError, bootstrapFolio } from '@/api/client';
import { Button }           from '@/components/shared/Button';
import { usePanelResize }   from '@/hooks/usePanelResize';
import { flushSync }        from 'react-dom';

// ---------------------------------------------------------------------------
// FolioScreen
// ---------------------------------------------------------------------------

interface FolioScreenProps {
  onClose: () => void;
}

/**
 * Run a navigation that moves the shared "New Page" button (chapters ↔ pages)
 * inside a View Transition so the button glides between its two positions
 * instead of popping. flushSync forces the synchronous view-state update so the
 * browser snapshots the new layout. Falls back to a plain call when the API is
 * unavailable or the user prefers reduced motion.
 */
function navigateWithTransition(fn: () => void) {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const start = (document as unknown as {
    startViewTransition?: (cb: () => void) => unknown;
  }).startViewTransition;
  if (!reduce && typeof start === 'function') {
    start.call(document, () => flushSync(fn));
  } else {
    fn();
  }
}

export function FolioScreen({ onClose }: FolioScreenProps) {
  const activeSpaceId = useAppStore((s) => s.activeSpaceId);
  // A repo working directory enables the "Bootstrap from repo" empty-state action.
  const hasWorkingDir = useAppStore((s) => !!s.spaces.find((sp) => sp.id === s.activeSpaceId)?.workingDirectory);

  const {
    view,
    active,
    chapters,
    activeChapterSlug,
    pages,
    activePage,
    loading,
    isMutating,
    loadIndex,
    openChapter,
    openPage,
    back,
    createPage,
    savePage,
    deletePage,
    reset,
    stale,
    checkStale,
  } = useFolioStore();

  // Resizable width + persistence — shared pattern with sibling panels (ADR-1 §5.1).
  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:folio',
    defaultWidth: 480,
    minWidth:     320,
    maxWidth:     800,
  });

  // ── New page modal state ─────────────────────────────────────────────────

  const [newPageOpen, setNewPageOpen] = useState(false);

  // ── Load on mount + space change ─────────────────────────────────────────

  const prevSpaceRef = useRef<string>(activeSpaceId);
  useEffect(() => {
    if (prevSpaceRef.current !== activeSpaceId) {
      prevSpaceRef.current = activeSpaceId;
      reset();
    }
    loadIndex();
  }, [activeSpaceId, reset, loadIndex]);

  // ── Poll for external changes while the panel is open ──────────────────────
  // File backend only (sqlite returns revision 0 → never stale). Surfaces the
  // refresh affordance when the on-disk .folio/ changes (git pull, MCP, manual).
  useEffect(() => {
    const id = setInterval(() => { checkStale(); }, 4000);
    return () => clearInterval(id);
  }, [checkStale, activeSpaceId]);

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleOpenChapter(slug: string) {
    // chapters → pages: the New Page button moves from the header to the page-list
    // sub-header — glide it via a View Transition.
    navigateWithTransition(() => openChapter(slug));
  }

  function handleBackToChapters() {
    // pages → chapters: glide the New Page button back to the header.
    navigateWithTransition(() => back());
  }

  function handleOpenPage(pageSlug: string) {
    if (!activeChapterSlug) return;
    openPage(activeChapterSlug, pageSlug);
  }

  function handleDeletePageFromList(pageSlug: string) {
    if (!activeChapterSlug) return;
    deletePage(activeChapterSlug, pageSlug);
  }

  function handleOpenNewPage() {
    setNewPageOpen(true);
  }

  function handleRefresh() {
    // Re-fetch from the backend. For the file backend this picks up external
    // edits (git pull, MCP writes, manual changes, renamed slugs). Reset first
    // so a stale chapter/page view — whose slug may have been renamed or deleted
    // — can't error; we always land back on a fresh chapter index.
    reset();
    loadIndex();
  }

  async function handleBootstrap() {
    const { showToast } = useAppStore.getState();
    try {
      await bootstrapFolio(activeSpaceId);
      showToast('Bootstrapping the folio from the repo… it will appear here shortly.', 'info');
      // The bootstrap runs in the background — poll the index until the folio
      // shows up (bounded to ~2 min so a non-repo / failure stops cleanly).
      let tries = 0;
      const poll = setInterval(() => {
        tries += 1;
        loadIndex();
        if (useFolioStore.getState().active || tries >= 24) clearInterval(poll);
      }, 5000);
    } catch (err) {
      const ae = err as ApiError;
      showToast(ae?.message ?? 'Could not bootstrap the folio.', 'error');
    }
  }

  async function handleCreatePage(payload: { slug: string; title: string; content: string }) {
    try {
      const page = await createPage(payload);
      if (!page) return false; // error already toasted
      setNewPageOpen(false);
      return true;
    } catch (err) {
      // Conflict or validation error — keep modal open.
      const ae = err as ApiError;
      if (ae?.status === 409) {
        useAppStore.getState().showToast(
          `Page "${payload.slug}" already exists`,
          'error',
        );
      } else {
        useAppStore.getState().showToast(
          (err as Error).message ?? 'Failed to create page',
          'error',
        );
      }
      return false;
    }
  }

  // Derive the chapter title for the breadcrumb.
  const activeChapter = activeChapterSlug
    ? chapters.find((c) => c.slug === activeChapterSlug) ?? null
    : null;
  const chapterTitle = activeChapter?.title ?? activeChapterSlug ?? '';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <aside
      className="panel-shell relative flex flex-col bg-surface-elevated border-l border-border h-full shrink-0 w-[var(--panel-w)] [animation:var(--animate-panel-in)]"
      style={{ '--panel-w': `${width}px` } as React.CSSProperties} // lint-ok: CSS custom-property injection for dynamic panel resize — Tailwind cannot set runtime CSS vars at the element level
      aria-label="Folio"
      data-testid="folio-screen"
    >
      {/* Left-edge drag handle — shared resize pattern with sibling panels */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        onMouseDown={handleMouseDown}
        className="panel-resize-handle absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors duration-150 z-10"
      />
      {/* ── Panel header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[20px] leading-none text-primary"
            aria-hidden="true"
          >
            menu_book
          </span>
          <h2 className="text-sm font-semibold text-text-primary">Folio</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* New Page shortcut — only on the chapter index. In the page-list view
              FolioPageList shows its own (chapter-contextual) New Page button, so
              showing it here too would duplicate it. */}
          {view === 'chapters' && (
            <Button variant="secondary" size="sm" onClick={handleOpenNewPage} aria-label="Create new page" className="folio-newpage-shared">
              <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">add</span>
              New Page
            </Button>
          )}

          {/* Refresh affordance — only when the on-disk folio changed externally. */}
          {stale && (
            <button
              type="button"
              onClick={handleRefresh}
              className="
                flex items-center gap-1.5 h-8 px-2.5 rounded-md
                text-xs font-medium text-primary bg-primary/10 border border-primary/20
                hover:bg-primary/20 transition-colors duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60
              "
              aria-label="Folio changed on disk — refresh"
              title="The folio changed on disk — click to reload"
            >
              <span
                className={`material-symbols-outlined text-[16px] leading-none ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              >
                refresh
              </span>
              Updated
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="
              w-8 h-8 flex items-center justify-center rounded-md
              text-text-secondary hover:text-text-primary hover:bg-surface-variant
              transition-[color,background-color] duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60
            "
            aria-label="Close Folio"
          >
            <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">

        {view === 'chapters' && (
          <FolioChapterList
            active={active}
            chapters={chapters}
            loading={loading}
            onOpenChapter={handleOpenChapter}
            onNewPage={handleOpenNewPage}
            canBootstrap={hasWorkingDir}
            onBootstrap={handleBootstrap}
          />
        )}

        {view === 'pages' && activeChapterSlug && (
          <FolioPageList
            chapterTitle={chapterTitle}
            pages={pages}
            loading={loading}
            onOpenPage={handleOpenPage}
            onDeletePage={handleDeletePageFromList}
            onNewPage={handleOpenNewPage}
            onBack={handleBackToChapters}
          />
        )}

        {view === 'page' && activePage && (
          <FolioPageEditor
            page={activePage}
            isMutating={isMutating}
            loading={loading}
            onBack={back}
            onSave={(updates) => savePage(activePage.chapterSlug, activePage.slug, updates)}
            onDelete={deletePage}
          />
        )}

      </div>

      {/* ── New Page modal ─────────────────────────────────────────────────── */}
      <NewPageModal
        open={newPageOpen}
        onClose={() => setNewPageOpen(false)}
        prefilledChapter={view === 'pages' ? (activeChapterSlug ?? '') : ''}
        chapters={chapters.map((c) => c.slug)}
        onSubmit={handleCreatePage}
        isMutating={isMutating}
      />
    </aside>
  );
}
