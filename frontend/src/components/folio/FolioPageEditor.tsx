/**
 * FolioPageEditor — Page view and direct markdown editor (T-006: folio-index-ui)
 *
 * Modes:
 *   View   → rendered markdown via MarkdownViewer + metadata footer
 *   Edit   → split pane: editable title + monospace textarea | live preview
 *            (stacked on mobile, side-by-side on sm+)
 *
 * Dirty-state guard: warns before navigating away with unsaved changes.
 * Delete: confirmation modal before removal.
 * No review flow — saves apply immediately via PUT /folio/pages/:c/:p.
 *
 * Neutral vocabulary: author='user' → "You", author='agent' → "Agent".
 */

import React, { useState, useEffect } from 'react';
import type { FolioPage } from '@/api/client';
import { Button } from '@/components/shared/Button';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { relativeTime, authorLabel } from '@/utils/folioUtils';

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

interface DeleteConfirmProps {
  open:       boolean;
  pageTitle:  string;
  onConfirm:  () => void;
  onCancel:   () => void;
  isMutating: boolean;
}

function DeleteConfirmDialog({ open, pageTitle, onConfirm, onCancel, isMutating }: DeleteConfirmProps) {
  const labelId = 'delete-page-confirm-title';
  return (
    <Modal open={open} onClose={onCancel} role="alertdialog" labelId={labelId} maxWidth="max-w-sm">
      <ModalHeader>
        <ModalTitle id={labelId}>Delete Page?</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <p className="text-sm text-text-secondary leading-relaxed">
          <span className="text-text-primary font-medium">"{pageTitle}"</span> will be permanently
          deleted. This cannot be undone.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={isMutating}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={isMutating}>
          {isMutating ? 'Deleting…' : 'Delete'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Unsaved-changes guard dialog
// ---------------------------------------------------------------------------

interface UnsavedChangesDialogProps {
  open:      boolean;
  onDiscard: () => void;
  onCancel:  () => void;
}

function UnsavedChangesDialog({ open, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  const labelId = 'unsaved-changes-title';
  return (
    <Modal open={open} onClose={onCancel} role="alertdialog" labelId={labelId} maxWidth="max-w-sm">
      <ModalHeader>
        <ModalTitle id={labelId}>Discard unsaved changes?</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <p className="text-sm text-text-secondary leading-relaxed">
          You have unsaved changes. If you go back now, your changes will be lost.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>Keep editing</Button>
        <Button variant="danger" onClick={onDiscard}>Discard changes</Button>
      </ModalFooter>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FolioPageEditorProps {
  page:        FolioPage;
  isMutating:  boolean;
  loading:     boolean;
  onBack:      () => void;
  onSave:      (updates: { content?: string; title?: string }) => Promise<void>;
  onDelete:    (chapterSlug: string, pageSlug: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FolioPageEditor({
  page,
  isMutating,
  loading,
  onBack,
  onSave,
  onDelete,
}: FolioPageEditorProps) {

  const [isEditing,    setIsEditing]    = useState(false);
  const [draftTitle,   setDraftTitle]   = useState(page.title);
  const [draftContent, setDraftContent] = useState(page.content);
  const [deleteOpen,   setDeleteOpen]   = useState(false);
  const [guardOpen,    setGuardOpen]    = useState(false);
  const [pendingBack,  setPendingBack]  = useState(false);

  // Sync draft when page prop changes (e.g. after save refresh).
  useEffect(() => {
    setDraftTitle(page.title);
    setDraftContent(page.content);
  }, [page.id, page.title, page.content]);

  const isDirty =
    isEditing &&
    (draftTitle !== page.title || draftContent !== page.content);

  // ── Navigation guard ───────────────────────────────────────────────────────

  function handleBack() {
    if (isDirty) {
      setPendingBack(true);
      setGuardOpen(true);
    } else {
      onBack();
    }
  }

  function handleGuardDiscard() {
    setGuardOpen(false);
    setIsEditing(false);
    setDraftTitle(page.title);
    setDraftContent(page.content);
    if (pendingBack) {
      setPendingBack(false);
      onBack();
    }
  }

  function handleGuardCancel() {
    setGuardOpen(false);
    setPendingBack(false);
  }

  // ── Edit / Cancel ──────────────────────────────────────────────────────────

  function handleEdit() {
    setDraftTitle(page.title);
    setDraftContent(page.content);
    setIsEditing(true);
  }

  function handleCancelEdit() {
    if (isDirty) {
      setGuardOpen(true);
    } else {
      setIsEditing(false);
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    try {
      await onSave({
        content: draftContent,
        ...(draftTitle !== page.title ? { title: draftTitle } : {}),
      });
      setIsEditing(false);
    } catch {
      // Error toast handled by the store; keep editing mode open.
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleConfirmDelete() {
    await onDelete(page.chapterSlug, page.slug);
    setDeleteOpen(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const rel    = relativeTime(page.updatedAt);
  const author = authorLabel(page.author);

  return (
    <div className="flex flex-col h-full" data-testid="folio-page-editor">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5 flex-shrink-0">
        <button
          type="button"
          onClick={handleBack}
          className="
            w-8 h-8 flex items-center justify-center rounded-md
            text-text-secondary hover:text-text-primary hover:bg-surface-variant
            transition-all duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60
          "
          aria-label="Back to page list"
        >
          <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">arrow_back</span>
        </button>

        {/* Title in view mode */}
        {!isEditing && (
          <h1 className="flex-1 text-base font-semibold text-text-primary truncate">
            {page.title}
          </h1>
        )}
        {isEditing && (
          <div
            className={`flex-1 h-2 rounded-full ${isDirty ? 'bg-warning/30' : 'bg-transparent'} transition-colors duration-200`}
            aria-hidden="true"
          />
        )}

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isEditing ? (
            <>
              <Button
                variant="secondary"
                onClick={handleEdit}
                aria-label="Edit page"
              >
                <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">edit</span>
                Edit
              </Button>
              <Button
                variant="icon"
                onClick={() => setDeleteOpen(true)}
                aria-label="Delete page"
                className="text-error hover:bg-error/10"
              >
                <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">delete</span>
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={handleCancelEdit}
                disabled={isMutating}
                aria-label="Cancel editing"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!isDirty || isMutating}
                aria-label="Save changes"
              >
                {isMutating ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center h-32" aria-label="Loading page…">
          <span className="material-symbols-outlined text-2xl text-text-secondary/40 animate-spin" aria-hidden="true">
            progress_activity
          </span>
        </div>
      ) : !isEditing ? (
        /* View mode */
        <div className="flex-1 overflow-y-auto">
          {page.content ? (
            <MarkdownViewer
              content={page.content}
              variant="prose"
              className="max-w-none"
            />
          ) : (
            <p className="text-sm text-text-secondary/60 italic">This page has no content yet. Click Edit to add some.</p>
          )}

          {/* Metadata footer */}
          <div className="mt-8 pt-4 border-t border-border flex items-center gap-2 text-xs text-text-secondary/60">
            <span>Author: {author}</span>
            <span aria-hidden="true">·</span>
            <span
              title={new Date(page.updatedAt).toLocaleString()}
              aria-label={`Last edited ${rel}`}
            >
              Last edited {rel}
            </span>
          </div>
        </div>
      ) : (
        /* Edit mode — split pane (stacked on mobile, side-by-side on sm+) */
        <div className="flex-1 flex flex-col sm:flex-row gap-4 min-h-0">

          {/* Editor pane */}
          <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">
            {/* Editable title */}
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              aria-label="Page title"
              placeholder="Page title"
              className="
                w-full h-10 px-3 rounded-md text-sm font-semibold
                bg-surface border border-border
                text-text-primary placeholder:text-text-secondary/40
                focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50
                transition-colors duration-150
              "
            />

            {/* Content textarea */}
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              aria-label="Page content"
              spellCheck
              className="
                flex-1 w-full px-3 py-2.5 rounded-md text-sm font-mono resize-none
                bg-surface border border-border
                text-text-primary placeholder:text-text-secondary/40
                focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50
                transition-colors duration-150
                leading-relaxed min-h-[200px]
              "
              placeholder="Write markdown content here…"
            />
          </div>

          {/* Preview pane */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="text-[11px] font-medium text-text-secondary/60 uppercase tracking-wider mb-2 px-1">
              Preview
            </div>
            <div className="flex-1 overflow-y-auto bg-surface border border-border rounded-md px-4 py-3 min-h-[200px]">
              {draftContent ? (
                <MarkdownViewer content={draftContent} variant="prose" className="max-w-none" />
              ) : (
                <p className="text-sm text-text-secondary/40 italic">Preview will appear here…</p>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <DeleteConfirmDialog
        open={deleteOpen}
        pageTitle={page.title}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteOpen(false)}
        isMutating={isMutating}
      />

      <UnsavedChangesDialog
        open={guardOpen}
        onDiscard={handleGuardDiscard}
        onCancel={handleGuardCancel}
      />
    </div>
  );
}
