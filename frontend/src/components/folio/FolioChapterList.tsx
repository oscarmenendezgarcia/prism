/**
 * FolioChapterList — Chapter index screen (T-005: folio-index-ui)
 *
 * Renders either the empty activation state ("no Folio yet") or a
 * list of Chapter cards each showing title + page count.
 *
 * Vocabulary: Folio → Chapter → Page (neutral, no code context).
 */

import React from 'react';
import type { FolioChapter } from '@/api/client';
import { Button } from '@/components/shared/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FolioChapterListProps {
  active:    boolean;
  chapters:  FolioChapter[];
  loading:   boolean;
  onOpenChapter:  (slug: string) => void;
  onNewPage: () => void;
  /** True when the space has a repo working dir → offer "Bootstrap from repo". */
  canBootstrap?: boolean;
  onBootstrap?: () => void;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyFolioState({
  onNewPage,
  canBootstrap,
  onBootstrap,
}: {
  onNewPage: () => void;
  canBootstrap?: boolean;
  onBootstrap?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-6 px-6 py-16 text-center"
      data-testid="folio-empty-state"
    >
      <div className="w-20 h-20 rounded-2xl bg-surface-variant/60 border border-border flex items-center justify-center">
        <span
          className="material-symbols-outlined text-5xl text-primary/60 select-none leading-none"
          aria-hidden="true"
        >
          menu_book
        </span>
      </div>

      <div className="flex flex-col items-center gap-2">
        <h2 className="text-lg font-semibold text-text-primary">
          This space has no Folio yet
        </h2>
        <p className="text-sm text-text-secondary max-w-xs">
          Create your first page to get started{canBootstrap ? ', or generate one from the repository.' : '.'}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Button
          variant="primary"
          onClick={onNewPage}
          aria-label="Create your first page"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
            add
          </span>
          Create Your First Page
        </Button>

        {canBootstrap && onBootstrap && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onBootstrap}
            aria-label="Bootstrap folio from the repository"
          >
            <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">
              auto_awesome
            </span>
            Bootstrap from repo
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapter card
// ---------------------------------------------------------------------------

function ChapterCard({
  chapter,
  onClick,
}: {
  chapter: FolioChapter;
  onClick: () => void;
}) {
  const pageLabel = chapter.pageCount === 1 ? '1 page' : `${chapter.pageCount} pages`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group w-full flex items-center justify-between gap-4
        px-5 py-4 rounded-xl
        bg-surface border border-border
        hover:border-primary/30 hover:bg-surface-elevated
        hover:shadow-[0_8px_24px_rgba(124,109,250,0.12)]
        transition-[border-color,background-color,box-shadow,transform] duration-200 ease-apple
        active:scale-[0.99]
        text-left
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60
      "
      aria-label={`Chapter: ${chapter.title}, ${pageLabel}. Click to view pages.`}
      data-testid={`chapter-card-${chapter.slug}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="material-symbols-outlined text-[20px] leading-none text-primary/70 flex-shrink-0"
          aria-hidden="true"
        >
          folder_open
        </span>
        <span className="text-sm font-semibold text-text-primary truncate">
          {chapter.title}
        </span>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs font-medium text-text-secondary bg-surface-variant px-2.5 py-1 rounded-full">
          {pageLabel}
        </span>
        <span
          className="material-symbols-outlined text-[18px] leading-none text-text-secondary/50 group-hover:text-primary/70 group-hover:translate-x-0.5 transition-[color,transform] duration-150"
          aria-hidden="true"
        >
          chevron_right
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FolioChapterList({
  active,
  chapters,
  loading,
  onOpenChapter,
  onNewPage,
  canBootstrap,
  onBootstrap,
}: FolioChapterListProps) {

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32" aria-label="Loading Folio index…">
        <span className="material-symbols-outlined text-3xl text-text-secondary/40 animate-spin select-none" aria-hidden="true">
          progress_activity
        </span>
      </div>
    );
  }

  if (!active || chapters.length === 0) {
    return <EmptyFolioState onNewPage={onNewPage} canBootstrap={canBootstrap} onBootstrap={onBootstrap} />;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="folio-chapter-list">
      {chapters.map((chapter) => (
        <ChapterCard
          key={chapter.slug}
          chapter={chapter}
          onClick={() => onOpenChapter(chapter.slug)}
        />
      ))}
    </div>
  );
}
