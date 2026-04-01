/**
 * Create task modal — form with title, type, assigned, description.
 * ADR-002: replaces the #modal-overlay static HTML + form logic in legacy app.js.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';
import type { CreateTaskPayload } from '@/types';

const TITLE_MAX = 200;

const TITLE_ID = 'create-task-modal-title';

const ASSIGNED_OPTIONS = [
  { value: '', label: '-- Unassigned --' },
  { value: 'arquitecto-senior', label: 'arquitecto-senior' },
  { value: 'ux-api-designer', label: 'ux-api-designer' },
  { value: 'programador-agent', label: 'programador-agent' },
  { value: 'qa-engineer-e2e', label: 'qa-engineer-e2e' },
];

const inputClass =
  'w-full px-3 py-2 border border-border rounded-md text-sm text-text-primary bg-surface-variant placeholder:text-text-disabled focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/40 transition-colors duration-150 h-12';
const errorClass = 'text-xs text-error mt-1';
const hintClass = 'text-xs text-text-secondary mt-1';
const labelClass = 'block text-sm font-medium text-text-primary mb-1.5';

export function CreateTaskModal() {
  const open = useAppStore((s) => s.createModalOpen);
  const closeModal = useAppStore((s) => s.closeCreateModal);
  const createTask = useAppStore((s) => s.createTask);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<'task' | 'research' | ''>('');
  const [assigned, setAssigned] = useState('');
  const [description, setDescription] = useState('');
  const [titleError, setTitleError] = useState('');
  const [typeError, setTypeError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  // Reset form when modal reopens
  useEffect(() => {
    if (open) {
      setTitle('');
      setType('');
      setAssigned('');
      setDescription('');
      setTitleError('');
      setTypeError('');
      setSubmitting(false);
      // Focus title input after paint
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open]);

  function validate(): boolean {
    let valid = true;
    const trimmed = title.trim();

    if (!trimmed) {
      setTitleError('Title is required');
      valid = false;
    } else if (trimmed.length > TITLE_MAX) {
      setTitleError(`Title must not exceed ${TITLE_MAX} characters`);
      valid = false;
    } else {
      setTitleError('');
    }

    if (!type) {
      setTypeError('Type is required');
      valid = false;
    } else {
      setTypeError('');
    }

    return valid;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const payload: CreateTaskPayload = {
      title: title.trim(),
      type: type as 'task' | 'research',
    };
    // Only include optional fields when non-empty (never send null)
    if (assigned) payload.assigned = assigned;
    const desc = description.trim();
    if (desc) payload.description = desc;

    setSubmitting(true);
    try {
      await createTask(payload);
      // Modal is closed by the store action on success
    } catch {
      // Error toast shown by store; just re-enable the submit button
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={closeModal} labelId={TITLE_ID}>
      <form onSubmit={handleSubmit} noValidate>
        <ModalHeader onClose={closeModal}>
          <ModalTitle id={TITLE_ID}>New Task</ModalTitle>
        </ModalHeader>

        <ModalBody className="flex flex-col gap-4">
          {/* Title */}
          <div>
            <label htmlFor="input-title" className={labelClass}>
              Title <span className="text-error">*</span>
            </label>
            <input
              id="input-title"
              ref={titleRef}
              className={`${inputClass} ${titleError ? 'border-error ring-1 ring-error' : ''}`}
              type="text"
              maxLength={TITLE_MAX}
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
              required
            />
            <div className="flex justify-between mt-1">
              <span className={titleError ? errorClass : hintClass} role="alert">
                {titleError || '\u00a0'}
              </span>
              <span className={hintClass}>{title.length} / {TITLE_MAX}</span>
            </div>
          </div>

          {/* Type */}
          <div>
            <label htmlFor="input-type" className={labelClass}>
              Type <span className="text-error">*</span>
            </label>
            <select
              id="input-type"
              className={`${inputClass} ${typeError ? 'border-error ring-1 ring-error' : ''}`}
              value={type}
              onChange={(e) => setType(e.target.value as 'task' | 'research' | '')}
              required
            >
              <option value="">-- Select type --</option>
              <option value="task">Task</option>
              <option value="research">Research</option>
            </select>
            {typeError && (
              <span className={errorClass} role="alert">{typeError}</span>
            )}
          </div>

          {/* Assigned */}
          <div>
            <label htmlFor="input-assigned" className={labelClass}>
              Assigned to
            </label>
            <select
              id="input-assigned"
              className={inputClass}
              value={assigned}
              onChange={(e) => setAssigned(e.target.value)}
            >
              {ASSIGNED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="input-description" className={labelClass}>
              Description
            </label>
            <textarea
              id="input-description"
              className="w-full px-3 py-2 border border-border rounded-md text-sm text-text-primary bg-surface-variant placeholder:text-text-disabled focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/40 transition-colors duration-150 resize-none"
              rows={3}
              placeholder="Optional details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting} aria-busy={submitting}>
            {submitting ? (
              <span className="flex items-center gap-2">
                <span
                  className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"
                  aria-hidden="true"
                />
                Creating...
              </span>
            ) : (
              'Create Task'
            )}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
