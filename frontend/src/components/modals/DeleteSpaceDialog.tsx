/**
 * Delete space confirmation dialog.
 * Fetches task count and shows danger-styled confirmation.
 * ADR-002: replaces #space-delete-overlay in legacy spaces.js.
 */

import React, { useState, useEffect } from 'react';
import { Modal, ModalBody } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';

const TITLE_ID = 'space-delete-title';

export function DeleteSpaceDialog() {
  const dialog = useAppStore((s) => s.deleteSpaceDialog);
  const closeDialog = useAppStore((s) => s.closeDeleteSpaceDialog);
  const deleteSpace = useAppStore((s) => s.deleteSpace);
  const spaces = useAppStore((s) => s.spaces);

  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isOpen = dialog?.open ?? false;
  const spaceId = dialog?.spaceId ?? '';
  const space = spaces.find((s) => s.id === spaceId);

  // Fetch task count whenever dialog opens
  useEffect(() => {
    if (!isOpen || !spaceId) return;
    setTaskCount(null);
    setSubmitting(false);

    api.getTasks(spaceId).then((data) => {
      const count =
        (data['todo']?.length ?? 0) +
        (data['in-progress']?.length ?? 0) +
        (data['done']?.length ?? 0);
      setTaskCount(count);
    }).catch(() => setTaskCount(null));
  }, [isOpen, spaceId]);

  async function handleConfirm() {
    if (!spaceId) return;
    setSubmitting(true);
    try {
      await deleteSpace(spaceId);
      closeDialog();
    } catch {
      // Error toast shown by store
      setSubmitting(false);
    }
  }

  return (
    <Modal open={isOpen} onClose={closeDialog} labelId={TITLE_ID} role="alertdialog">
      <ModalBody className="flex flex-col items-center text-center gap-4 py-8">
        {/* Danger icon */}
        <span
          className="material-symbols-outlined text-5xl text-error icon-filled"
          aria-hidden="true"
        >
          delete_forever
        </span>

        {/* Title */}
        <h2 id={TITLE_ID} className="text-lg font-semibold text-text-primary">
          Delete &ldquo;{space?.name ?? ''}&rdquo;?
        </h2>

        {/* Body */}
        <p className="text-sm text-text-secondary">
          This will permanently delete the space and all its tasks. This action cannot be undone.
        </p>

        {/* Task count info */}
        {taskCount !== null && taskCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-info bg-info-container px-4 py-2 rounded-md w-full justify-center">
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">info</span>
            {taskCount} task{taskCount !== 1 ? 's' : ''} will be deleted.
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 w-full justify-center mt-2">
          <Button variant="ghost" onClick={closeDialog} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </ModalBody>
    </Modal>
  );
}
