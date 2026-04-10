/**
 * Create task modal — form with title, type, assigned, description.
 * ADR-002: replaces the #modal-overlay static HTML + form logic in legacy app.js.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  'w-full px-3 py-2 border border-border rounded-md text-sm text-text-primary bg-surface-variant placeholder:text-text-disabled focus:outline-hidden focus:border-primary focus:ring-2 focus:ring-primary/40 transition-colors duration-150 h-12';
const errorClass = 'text-xs text-error mt-1';
const hintClass = 'text-xs text-text-secondary mt-1';
const labelClass = 'block text-sm font-medium text-text-primary mb-1.5';

export function CreateTaskModal() {
  const open = useAppStore((s) => s.createModalOpen);
  const closeModal = useAppStore((s) => s.closeCreateModal);
  const createTask = useAppStore((s) => s.createTask);
  const availableAgents = useAppStore((s) => s.availableAgents);
  const loadAgents = useAppStore((s) => s.loadAgents);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<'feature' | 'bug' | 'tech-debt' | 'chore' | ''>('');
  const [assigned, setAssigned] = useState('');
  const [description, setDescription] = useState('');
  const [pipeline, setPipeline] = useState<string[]>([]);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [typeError, setTypeError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const agentIds = availableAgents.map((a) => a.id);

  const addStage = useCallback((id: string) => {
    if (id && !pipeline.includes(id)) setPipeline((prev) => [...prev, id]);
  }, [pipeline]);

  const removeStage = useCallback((idx: number) => {
    setPipeline((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const moveStage = useCallback((idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= pipeline.length) return;
    setPipeline((prev) => {
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  }, [pipeline]);

  const titleRef = useRef<HTMLInputElement>(null);

  // Reset form when modal reopens; load agents for pipeline dropdown
  useEffect(() => {
    if (open) {
      setTitle('');
      setType('');
      setAssigned('');
      setDescription('');
      setPipeline([]);
      setPipelineOpen(false);
      setTitleError('');
      setTypeError('');
      setSubmitting(false);
      if (availableAgents.length === 0) loadAgents();
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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
      type: type as 'feature' | 'bug' | 'tech-debt' | 'chore',
    };
    // Only include optional fields when non-empty (never send null)
    if (assigned) payload.assigned = assigned;
    const desc = description.trim();
    if (desc) payload.description = desc;
    if (pipeline.length > 0) payload.pipeline = pipeline;

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
              onChange={(e) => setType(e.target.value as 'feature' | 'bug' | 'tech-debt' | 'chore' | '')}
              required
            >
              <option value="">-- Select type --</option>
              <option value="feature">Feature</option>
              <option value="bug">Bug</option>
              <option value="tech-debt">Tech Debt</option>
              <option value="chore">Chore</option>
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
              className="w-full px-3 py-2 border border-border rounded-md text-sm text-text-primary bg-surface-variant placeholder:text-text-disabled focus:outline-hidden focus:border-primary focus:ring-2 focus:ring-primary/40 transition-colors duration-150 resize-none"
              rows={3}
              placeholder="Optional details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Pipeline (optional) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className={labelClass} style={{ marginBottom: 0 }}>Pipeline</span>
              {!pipelineOpen && (
                <button
                  type="button"
                  onClick={() => setPipelineOpen(true)}
                  className="text-xs text-primary hover:text-primary/80 focus:outline-hidden focus:ring-2 focus:ring-primary rounded px-1.5 py-0.5 transition-colors duration-150"
                >
                  {pipeline.length > 0 ? 'Edit' : 'Configure'}
                </button>
              )}
            </div>

            {!pipelineOpen ? (
              <p className="text-sm text-text-secondary italic">
                {pipeline.length > 0
                  ? pipeline.join(' → ')
                  : '(space default)'}
              </p>
            ) : (
              <div className="flex flex-col gap-2 border border-border rounded-md p-3 bg-surface-variant">
                {pipeline.length === 0 ? (
                  <p className="text-xs text-text-secondary italic">No stages — will use space default.</p>
                ) : (
                  <ol className="flex flex-col gap-1">
                    {pipeline.map((id, idx) => (
                      <li key={id} className="flex items-center gap-1.5">
                        <span className="flex-1 text-xs font-medium text-text-primary bg-surface px-2 py-1 rounded border border-border">
                          {id}
                        </span>
                        <button type="button" onClick={() => moveStage(idx, -1)} disabled={idx === 0}
                          className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-primary disabled:opacity-30 transition-colors">
                          <span className="material-symbols-outlined text-sm leading-none">arrow_upward</span>
                        </button>
                        <button type="button" onClick={() => moveStage(idx, 1)} disabled={idx === pipeline.length - 1}
                          className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-primary disabled:opacity-30 transition-colors">
                          <span className="material-symbols-outlined text-sm leading-none">arrow_downward</span>
                        </button>
                        <button type="button" onClick={() => removeStage(idx)}
                          className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-error hover:bg-error/10 rounded transition-colors">
                          <span className="material-symbols-outlined text-sm leading-none">close</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <select
                  className={`${inputClass} h-9`}
                  value=""
                  onChange={(e) => { addStage(e.target.value); e.target.value = ''; }}
                  aria-label="Add a stage to the pipeline"
                >
                  <option value="">+ Add stage…</option>
                  {agentIds.filter((id) => !pipeline.includes(id)).map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => { setPipeline([]); setPipelineOpen(false); }}
                    className="text-xs text-text-secondary hover:text-text-primary transition-colors px-2 py-1">
                    Clear
                  </button>
                  <button type="button" onClick={() => setPipelineOpen(false)}
                    className="text-xs text-primary hover:text-primary/80 transition-colors px-2 py-1">
                    Done
                  </button>
                </div>
              </div>
            )}
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
