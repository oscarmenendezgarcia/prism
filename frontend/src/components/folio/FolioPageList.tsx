/**
 * FolioPageList — Pages within a Chapter (T-005: folio-index-ui)
 *
 * Shows each page's title, author ("You" / "Agent"), and relative updatedAt.
 * Context menu per row: Open, Delete.
 *
 * Vocabulary: neutral author labels — "You" (user), "Agent" (agent).
 */

import React, { useState, useRef, useEffect } from 'react';
import type { FolioPageMeta } from '@/api/client';
import { Button } from '@/components/shared/Button';
import { relativeTime, authorLabel } from '@/utils/folioUtils';

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface PageRowMenuProps {
  onOpen:   () => void;
  onDelete: () => void;
}

function PageRowMenu({ onOpen, onDelete }: PageRowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="Page actions"
        aria-expanded={open}
        className="
          w-7 h-7 flex items-center justify-center rounded-md
          text-text-secondary/50 hover:text-text-primary hover:bg-surface-variant
          transition-[color,background-color,opacity] duration-100
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60
          opacity-0 group-hover:opacity-100
        "
      >
        <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">more_horiz</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-36 bg-surface-elevated border border-border rounded-xl shadow-modal py-1.5 z-10 origin-top-right transition-[opacity,transform] duration-150 ease-apple starting:opacity-0 starting:scale-95"
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onOpen(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-surface-variant transition-colors duration-100 text-left"
          >
            <span className="material-symbols-outlined text-[16px] leading-none text-text-secondary" aria-hidden="true">open_in_new</span>
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors duration-100 text-left"
          >
            <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">delete</span>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page row
// ---------------------------------------------------------------------------

interface PageRowProps {
  page:     FolioPageMeta;
  onOpen:   () => void;
  onDelete: () => void;
}

function PageRow({ page, onOpen, onDelete }: PageRowProps) {
  const rel   = relativeTime(page.updatedAt);
  const label = authorLabel(page.author);

  return (
    /* BUG-003 fix: outer element must not be a <button> because PageRowMenu
       contains a real <button>. HTML5 prohibits interactive content inside
       <button>. A div with role="button" is a valid host for child buttons. */
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className="
        group w-full flex items-center gap-4
        px-5 py-3.5 rounded-xl
        bg-surface border border-border
        hover:border-primary/30 hover:bg-surface-elevated
        transition-[border-color,background-color,transform] duration-200 ease-apple
        active:scale-[0.99]
        text-left cursor-pointer
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60
      "
      aria-label={`Page: ${page.title}, Author: ${label}, Updated ${rel}`}
      data-testid={`page-row-${page.slug}`}
    >
      <span
        className="material-symbols-outlined text-[18px] leading-none text-text-secondary/50 flex-shrink-0"
        aria-hidden="true"
      >
        description
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">
          {page.title}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-text-secondary">{label}</span>
          <span className="text-xs text-text-secondary/40" aria-hidden="true">·</span>
          <span
            className="text-xs text-text-secondary"
            aria-label={`Updated ${rel}`}
            title={new Date(page.updatedAt).toLocaleString()}
          >
            Updated {rel}
          </span>
        </div>
      </div>

      {/* Prevent click propagation so the row's onClick doesn't fire */}
      <div onClick={(e) => e.stopPropagation()}>
        <PageRowMenu onOpen={onOpen} onDelete={onDelete} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FolioPageListProps {
  chapterTitle: string;
  pages:        FolioPageMeta[];
  loading:      boolean;
  onOpenPage:   (slug: string) => void;
  onDeletePage: (slug: string) => void;
  onNewPage:    () => void;
  onBack:       () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FolioPageList({
  chapterTitle,
  pages,
  loading,
  onOpenPage,
  onDeletePage,
  onNewPage,
  onBack,
}: FolioPageListProps) {

  return (
    <div className="flex flex-col h-full" data-testid="folio-page-list">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={onBack}
          className="
            w-8 h-8 flex items-center justify-center rounded-md
            text-text-secondary hover:text-text-primary hover:bg-surface-variant
            transition-[color,background-color] duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60
          "
          aria-label="Back to chapters"
        >
          <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">arrow_back</span>
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-text-primary truncate">{chapterTitle}</h2>
          <p className="text-xs text-text-secondary">
            {pages.length} {pages.length === 1 ? 'page' : 'pages'}
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={onNewPage} aria-label="Create new page" className="folio-newpage-shared">
          <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">add</span>
          New Page
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-24" aria-label="Loading pages…">
          <span className="material-symbols-outlined text-2xl text-text-secondary/40 animate-spin" aria-hidden="true">
            progress_activity
          </span>
        </div>
      ) : pages.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <span className="material-symbols-outlined text-4xl text-text-secondary/30 select-none" aria-hidden="true">article</span>
          <div>
            <p className="text-sm text-text-secondary">No pages in this chapter yet.</p>
            <button
              type="button"
              onClick={onNewPage}
              className="mt-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
            >
              Create a page
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pages.map((page) => (
            <PageRow
              key={page.slug}
              page={page}
              onOpen={() => onOpenPage(page.slug)}
              onDelete={() => onDeletePage(page.slug)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
