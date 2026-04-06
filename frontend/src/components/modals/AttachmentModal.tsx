/**
 * Attachment viewer modal with 4 states: loading, text content, file content, error.
 * ADR-002: replaces openAttachmentModal() in legacy app.js.
 * Stitch screens S-02 (loading) / S-03 (text) / S-04 (file) / S-05 (error).
 *
 * Navigation: when the task has multiple attachments, prev/next buttons allow
 * cycling through them without closing the modal.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, ModalHeader, ModalTitle } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';
import type { AttachmentContent } from '@/types';

const TITLE_ID = 'attachment-modal-title';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'content'; data: AttachmentContent }
  | { kind: 'error'; userMessage: string; errorCode: string };

function mapError(message: string): { userMessage: string; errorCode: string } {
  if (message.includes('not found') || message === 'HTTP 404') {
    return { userMessage: 'Attachment not found', errorCode: 'Error 404' };
  }
  if (message.includes('does not exist on disk')) {
    return { userMessage: 'File not found on disk', errorCode: 'Error 422' };
  }
  if (message.includes('exceeds the 5 MB')) {
    return { userMessage: 'File is too large to display', errorCode: 'Error 413' };
  }
  return { userMessage: message || 'Failed to load attachment', errorCode: 'Error' };
}

/** Returns true when the attachment filename has a .md extension. */
function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith('.md');
}

export function AttachmentModal() {
  const modal = useAppStore((s) => s.attachmentModal);
  const closeModal = useAppStore((s) => s.closeAttachmentModal);
  const openAttachmentModal = useAppStore((s) => s.openAttachmentModal);
  const openMarkdownModal = useAppStore((s) => s.openMarkdownModal);

  const [viewState, setViewState] = useState<ViewState>({ kind: 'loading' });

  const isOpen = modal?.open ?? false;
  const attachments = modal?.attachments ?? [];
  const total = attachments.length;
  const currentIndex = modal?.index ?? 0;
  const hasMultiple = total > 1;

  // Load content whenever the modal opens or the current index changes
  useEffect(() => {
    if (!isOpen || !modal) return;
    setViewState({ kind: 'loading' });

    api.getAttachmentContent(modal.spaceId, modal.taskId, modal.index)
      .then((data) => setViewState({ kind: 'content', data }))
      .catch((err: Error) => {
        const mapped = mapError(err.message);
        setViewState({ kind: 'error', ...mapped });
      });
  }, [isOpen, modal?.spaceId, modal?.taskId, modal?.index]);

  const navigateTo = useCallback((nextIndex: number) => {
    if (!modal) return;
    const target = attachments[nextIndex];
    if (!target) return;
    openAttachmentModal(modal.spaceId, modal.taskId, nextIndex, target.name, attachments);
  }, [modal, attachments, openAttachmentModal]);

  const goToPrev = useCallback(() => navigateTo(currentIndex - 1), [navigateTo, currentIndex]);
  const goToNext = useCallback(() => navigateTo(currentIndex + 1), [navigateTo, currentIndex]);

  if (!isOpen) return null;

  const isFileType = viewState.kind === 'content' && viewState.data.type === 'file';
  const headerIcon = isFileType ? 'folder' : 'attach_file';

  return (
    <Modal open={isOpen} onClose={closeModal} labelId={TITLE_ID} className="max-w-2xl">
      <ModalHeader onClose={closeModal}>
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="material-symbols-outlined text-xl text-text-secondary shrink-0"
            aria-hidden="true"
          >
            {headerIcon}
          </span>
          <ModalTitle id={TITLE_ID} className="truncate">{modal?.name ?? 'Attachment'}</ModalTitle>
          {hasMultiple && (
            <span className="ml-1 shrink-0 text-xs text-text-secondary tabular-nums">
              {currentIndex + 1} / {total}
            </span>
          )}
        </div>
      </ModalHeader>

      {/* Body */}
      <div className="px-6 py-4 min-h-[200px]">
        {/* ── Loading state (Stitch S-02) ── */}
        {viewState.kind === 'loading' && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            {/* Spinner */}
            <div className="relative w-10 h-10">
              <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin" />
            </div>
            <p className="text-sm text-text-secondary">Loading content...</p>
          </div>
        )}

        {/* ── Content state (Stitch S-03 text / S-04 file) ── */}
        {viewState.kind === 'content' && (
          <div className="flex flex-col gap-3">
            {/* Markdown files: render with MarkdownViewer; plain files: raw pre */}
            {isMarkdownFile(modal?.name ?? '') ? (
              <div className="border border-border rounded-md overflow-hidden">
                <div className="p-4 overflow-auto max-h-96 bg-surface">
                  <MarkdownViewer content={viewState.data.content} />
                </div>
              </div>
            ) : (
              <div className="border border-border rounded-md overflow-hidden">
                <pre className="p-4 text-xs font-mono text-text-primary overflow-auto max-h-96 whitespace-pre-wrap break-words bg-surface">
                  {viewState.data.content}
                </pre>
              </div>
            )}

            {/* Source file path banner (Stitch S-04) */}
            {viewState.data.type === 'file' && viewState.data.source && (
              <div className="flex items-start gap-2 px-3 py-2 bg-primary-container border-l-2 border-primary rounded-r-md">
                <span
                  className="material-symbols-outlined text-base text-primary mt-0.5 leading-none"
                  aria-hidden="true"
                >
                  info
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-text-secondary">Source File Path</span>
                  <code className="text-xs text-text-primary font-mono break-all">
                    {viewState.data.source}
                  </code>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
              {/* Navigation controls — only rendered when the task has multiple attachments */}
              {hasMultiple ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="icon"
                    onClick={goToPrev}
                    disabled={currentIndex === 0}
                    aria-label="Previous attachment"
                    title="Previous attachment"
                  >
                    <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
                      chevron_left
                    </span>
                  </Button>
                  <Button
                    variant="icon"
                    onClick={goToNext}
                    disabled={currentIndex === total - 1}
                    aria-label="Next attachment"
                    title="Next attachment"
                  >
                    <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
                      chevron_right
                    </span>
                  </Button>
                </div>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-3">
                <Button variant="ghost" onClick={closeModal}>
                  Close
                </Button>
                {/* Markdown: offer full-screen viewer; others: copy raw */}
                {isMarkdownFile(modal?.name ?? '') ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (viewState.kind === 'content') {
                        openMarkdownModal(
                          modal?.name ?? 'Document',
                          viewState.data.content,
                          viewState.data.source,
                        );
                        closeModal();
                      }
                    }}
                  >
                    <span
                      className="material-symbols-outlined text-base leading-none"
                      aria-hidden="true"
                    >
                      open_in_full
                    </span>
                    View full
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (viewState.kind === 'content') {
                        navigator.clipboard.writeText(viewState.data.content).catch(() => {});
                      }
                    }}
                  >
                    Copy
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Error state (Stitch S-05) ── */}
        {viewState.kind === 'error' && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <span
              className="material-symbols-outlined text-4xl text-error icon-filled"
              aria-hidden="true"
            >
              warning
            </span>
            <h4 className="text-sm font-semibold text-text-primary">{viewState.userMessage}</h4>
            <span className="px-2 py-0.5 text-xs font-medium text-error bg-error-container border border-error/30 rounded-xs">
              {viewState.errorCode}
            </span>
            <p className="text-sm text-text-secondary">
              The file referenced by this attachment could not be loaded from the server.
            </p>
            <hr className="w-full border-border" />
            <p className="text-sm text-text-secondary">
              Contact the agent that created this attachment to re-upload it.
            </p>
            <Button variant="ghost" onClick={closeModal}>
              Close
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
