/**
 * Confirmation dialog shown when the user tries to switch files or close the
 * config panel while there are unsaved changes.
 * ADR-1 §5.2: uses existing Modal with role="alertdialog".
 */

import React from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';

const LABEL_ID = 'discard-dialog-title';

interface DiscardChangesDialogProps {
  open: boolean;
  /** Called when the user confirms they want to discard changes. */
  onDiscard: () => void;
  /** Called when the user cancels — returns to the editor without changes. */
  onCancel: () => void;
}

export function DiscardChangesDialog({ open, onDiscard, onCancel }: DiscardChangesDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      role="alertdialog"
      labelId={LABEL_ID}
    >
      <ModalHeader onClose={onCancel}>
        <ModalTitle id={LABEL_ID}>Unsaved Changes</ModalTitle>
      </ModalHeader>

      <ModalBody>
        <p className="text-sm text-text-secondary">
          You have unsaved changes. Do you want to discard them?
        </p>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onDiscard}>
          Discard
        </Button>
      </ModalFooter>
    </Modal>
  );
}
