/**
 * NewPageModal — Create a new Folio page (T-006: folio-index-ui)
 *
 * Fields: chapter slug (pre-filled when opening from a chapter),
 *         page slug (auto-slugified from title), title (optional),
 *         content (optional initial markdown).
 *
 * This is the activation gesture: creating the first page materializes
 * the Folio for the space (createIfMissing:true, author:'user').
 *
 * Slug grammar: [a-z0-9]+(-[a-z0-9]+)*
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLUG_SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isValidSlug(s: string): boolean {
  return SLUG_SEGMENT_RE.test(s);
}

/** Convert a free-text title to a lowercase, hyphenated slug segment. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // strip non-alphanumeric except spaces/hyphens
    .trim()
    .replace(/[\s_]+/g, '-')        // spaces/underscores → hyphens
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '');         // strip leading/trailing hyphens
}

/** Convert a slug segment to Title Case. */
function toTitleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewPageModalProps {
  open:              boolean;
  onClose:           () => void;
  /** If provided, pre-fills the chapter slug field. */
  prefilledChapter?: string;
  /** Called when the user confirms. Returns false to keep modal open (e.g. on conflict). */
  onSubmit: (payload: { slug: string; title: string; content: string }) => Promise<boolean>;
  isMutating: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewPageModal({
  open,
  onClose,
  prefilledChapter = '',
  onSubmit,
  isMutating,
}: NewPageModalProps) {

  const [chapterSlug, setChapterSlug] = useState(prefilledChapter);
  const [pageSlug,    setPageSlug]    = useState('');
  const [title,       setTitle]       = useState('');
  const [content,     setContent]     = useState('');
  const [slugManual,  setSlugManual]  = useState(false);

  // Field-level errors
  const [chapterError, setChapterError] = useState('');
  const [pageError,    setPageError]    = useState('');

  const titleRef = useRef<HTMLInputElement>(null);

  // Reset when modal opens.
  useEffect(() => {
    if (open) {
      setChapterSlug(prefilledChapter);
      setPageSlug('');
      setTitle('');
      setContent('');
      setSlugManual(false);
      setChapterError('');
      setPageError('');
      // Focus title on open
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open, prefilledChapter]);

  // Auto-slugify title → page slug (unless user has manually edited the slug).
  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugManual) {
      setPageSlug(slugify(value));
    }
  }

  function handlePageSlugChange(value: string) {
    setSlugManual(true);
    setPageSlug(value);
  }

  function validate(): boolean {
    let ok = true;

    if (!isValidSlug(chapterSlug)) {
      setChapterError('Must match [a-z0-9]+(-[a-z0-9]+)* (lowercase letters, numbers, hyphens)');
      ok = false;
    } else {
      setChapterError('');
    }

    if (!isValidSlug(pageSlug)) {
      setPageError('Must match [a-z0-9]+(-[a-z0-9]+)* (lowercase letters, numbers, hyphens)');
      ok = false;
    } else {
      setPageError('');
    }

    return ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const slug        = `${chapterSlug}/${pageSlug}`;
    const resolvedTitle = title.trim() || toTitleCase(pageSlug);

    const closed = await onSubmit({ slug, title: resolvedTitle, content });
    if (closed) onClose();
  }

  const canSubmit =
    isValidSlug(chapterSlug) &&
    isValidSlug(pageSlug) &&
    !isMutating;

  const titleId = 'new-page-modal-title';

  return (
    <Modal open={open} onClose={onClose} labelId={titleId} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} noValidate>
        <ModalHeader>
          <ModalTitle id={titleId}>Create a new page</ModalTitle>
        </ModalHeader>

        <ModalBody className="flex flex-col gap-5">

          {/* Title field (optional — drives slug auto-fill) */}
          <div>
            <label htmlFor="np-title" className="block text-xs font-medium text-text-secondary mb-1.5">
              Title <span className="text-text-secondary/60 font-normal">(optional)</span>
            </label>
            <input
              ref={titleRef}
              id="np-title"
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="My New Page"
              className="
                w-full h-10 px-3 rounded-md text-sm
                bg-surface border border-border
                text-text-primary placeholder:text-text-secondary/40
                focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50
                transition-colors duration-150
              "
            />
          </div>

          {/* Chapter slug */}
          <div>
            <label htmlFor="np-chapter" className="block text-xs font-medium text-text-secondary mb-1.5">
              Chapter <span className="text-error text-xs" aria-hidden="true">*</span>
            </label>
            <input
              id="np-chapter"
              type="text"
              value={chapterSlug}
              onChange={(e) => { setChapterSlug(e.target.value); setChapterError(''); }}
              placeholder="architecture"
              autoComplete="off"
              spellCheck={false}
              className={`
                w-full h-10 px-3 rounded-md text-sm font-mono
                bg-surface border
                text-text-primary placeholder:text-text-secondary/40
                focus:outline-none focus:ring-2 focus:ring-primary/50
                transition-colors duration-150
                ${chapterError ? 'border-error focus:border-error' : 'border-border focus:border-primary/50'}
              `}
              aria-describedby={chapterError ? 'np-chapter-error' : undefined}
              required
            />
            {chapterError && (
              <p id="np-chapter-error" role="alert" className="mt-1 text-xs text-error">
                {chapterError}
              </p>
            )}
          </div>

          {/* Page slug */}
          <div>
            <label htmlFor="np-page" className="block text-xs font-medium text-text-secondary mb-1.5">
              Page <span className="text-error text-xs" aria-hidden="true">*</span>
            </label>
            <input
              id="np-page"
              type="text"
              value={pageSlug}
              onChange={(e) => handlePageSlugChange(e.target.value)}
              placeholder="getting-started"
              autoComplete="off"
              spellCheck={false}
              className={`
                w-full h-10 px-3 rounded-md text-sm font-mono
                bg-surface border
                text-text-primary placeholder:text-text-secondary/40
                focus:outline-none focus:ring-2 focus:ring-primary/50
                transition-colors duration-150
                ${pageError ? 'border-error focus:border-error' : 'border-border focus:border-primary/50'}
              `}
              aria-describedby={pageError ? 'np-page-error' : undefined}
              required
            />
            {pageError && (
              <p id="np-page-error" role="alert" className="mt-1 text-xs text-error">
                {pageError}
              </p>
            )}
            <p className="mt-1 text-xs text-text-secondary/60">
              Lowercase letters, numbers, and hyphens only. Example: <code className="font-mono text-[11px]">getting-started</code>
            </p>
          </div>

          {/* Initial content */}
          <div>
            <label htmlFor="np-content" className="block text-xs font-medium text-text-secondary mb-1.5">
              Initial content <span className="text-text-secondary/60 font-normal">(optional)</span>
            </label>
            <textarea
              id="np-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# My New Page&#10;&#10;Start writing here…"
              rows={4}
              spellCheck
              className="
                w-full px-3 py-2.5 rounded-md text-sm font-mono resize-y
                bg-surface border border-border
                text-text-primary placeholder:text-text-secondary/40
                focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50
                transition-colors duration-150
                leading-relaxed
              "
            />
          </div>

        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isMutating}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit || isMutating}>
            {isMutating ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
