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
import { ApiError }         from '@/api/client';
import { Button }           from '@/components/shared/Button';

// ---------------------------------------------------------------------------
// FolioScreen
// ---------------------------------------------------------------------------

interface FolioScreenProps {
  onClose: () => void;
}

export function FolioScreen({ onClose }: FolioScreenProps) {
  const activeSpaceId = useAppStore((s) => s.activeSpaceId);

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
  } = useFolioStore();

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

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleOpenChapter(slug: string) {
    openChapter(slug);
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
    <div
      className="flex flex-col h-full bg-background"
      data-testid="folio-screen"
    >
      {/* ── Panel header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
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
          {/* New Page shortcut in header (only visible on chapter/page-list view) */}
          {(view === 'chapters' || view === 'pages') && (
            <Button variant="secondary" onClick={handleOpenNewPage} aria-label="Create new page">
              <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">add</span>
              New Page
            </Button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="
              w-8 h-8 flex items-center justify-center rounded-md
              text-text-secondary hover:text-text-primary hover:bg-surface-variant
              transition-all duration-150
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
            onBack={back}
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
        onSubmit={handleCreatePage}
        isMutating={isMutating}
      />
    </div>
  );
}
