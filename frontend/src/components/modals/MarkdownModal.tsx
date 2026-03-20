/**
 * MarkdownModal — full-width modal that renders a markdown attachment
 * using the MarkdownViewer shared component.
 *
 * Opened via useAppStore.openMarkdownModal(title, content, source?).
 * Triggered by AttachmentModal when the attachment name ends with ".md".
 *
 * Layout:
 *   ModalHeader  — filename + markdown icon
 *   ModalBody    — scrollable MarkdownViewer
 *   source banner (optional) — shows disk path for file-type attachments
 *   ModalFooter  — Copy raw | Close
 */

import React, { useCallback, useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { useAppStore } from '@/stores/useAppStore';

const TITLE_ID = 'markdown-modal-title';

export function MarkdownModal() {
  const modal = useAppStore((s) => s.markdownModal);
  const closeMarkdownModal = useAppStore((s) => s.closeMarkdownModal);

  const [copied, setCopied] = useState(false);

  const isOpen = modal?.open ?? false;

  const handleCopy = useCallback(async () => {
    if (!modal) return;
    try {
      await navigator.clipboard.writeText(modal.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore
    }
  }, [modal]);

  const handleClose = useCallback(() => {
    closeMarkdownModal();
    setCopied(false);
  }, [closeMarkdownModal]);

  if (!isOpen || !modal) return null;

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      labelId={TITLE_ID}
      className="max-w-3xl"
    >
      <ModalHeader onClose={handleClose}>
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-xl text-primary leading-none"
            aria-hidden="true"
          >
            description
          </span>
          <ModalTitle id={TITLE_ID}>{modal.title}</ModalTitle>
        </div>
      </ModalHeader>

      <ModalBody className="max-h-[60vh] overflow-y-auto">
        <MarkdownViewer content={modal.content} />

        {/* Source file path banner — shown when attachment type is "file" */}
        {modal.source && (
          <div className="flex items-start gap-2 px-3 py-2 mt-4 bg-primary-container border-l-2 border-primary rounded-r-md">
            <span
              className="material-symbols-outlined text-base text-primary mt-0.5 leading-none"
              aria-hidden="true"
            >
              info
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-text-secondary">Source File Path</span>
              <code className="text-xs text-text-primary font-mono break-all">
                {modal.source}
              </code>
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose}>
          Close
        </Button>
        <Button variant="secondary" onClick={handleCopy} aria-label="Copy raw markdown">
          <span
            className="material-symbols-outlined text-base leading-none"
            aria-hidden="true"
          >
            {copied ? 'check' : 'content_copy'}
          </span>
          {copied ? 'Copied!' : 'Copy raw'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
