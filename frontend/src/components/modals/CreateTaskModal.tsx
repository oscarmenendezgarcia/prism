/**
 * Create task modal — form with title, type, assigned, description.
 * ADR-002: replaces the #modal-overlay static HTML + form logic in legacy app.js.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { LabelsInput } from '@/components/shared/LabelsInput';
import { AssigneeSelect } from '@/components/shared/AssigneeSelect';
import { useAppStore, useTasks } from '@/stores/useAppStore';
import { allTasks, PRIORITIES, TYPES } from '@/utils/issues';
import type { CreateTaskPayload, Priority, TaskType } from '@/types';

const TITLE_MAX = 200;

const TITLE_ID = 'create-task-modal-title';

const errorClass = 'text-xs text-error mt-1';
const hintClass = 'text-xs text-text-secondary mt-1';
const labelClass = 'block text-sm font-medium text-text-primary mb-1.5';

export function CreateTaskModal() {
  const open = useAppStore((s) => s.createModalOpen);
  const closeModal = useAppStore((s) => s.closeCreateModal);
  const createTask = useAppStore((s) => s.createTask);
  const epics = allTasks(useTasks()).filter((t) => t.type === 'epic');

  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType | ''>('');
  const [assigned, setAssigned] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [epicId, setEpicId] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
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
      setPriority('medium');
      setEpicId('');
      setLabels([]);
      setDueDate('');
      setDescription('');
      setTitleError('');
      setTypeError('');
      setSubmitting(false);
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
      type: type as TaskType,
      priority,
    };
    // Only include optional fields when non-empty (never send null)
    if (assigned.trim()) payload.assigned = assigned.trim();
    const desc = description.trim();
    if (desc) payload.description = desc;
    if (epicId && type !== 'epic') payload.parentId = epicId;
    if (labels.length > 0) payload.labels = labels;
    if (dueDate) payload.dueDate = dueDate;

    setSubmitting(true);
    try {
      await createTask(payload);
      // Modal is closed by the store action on success
    } catch {
      // Error toast shown by store; just re-enable the submit button
      setSubmitting(false);
    }
  }

  const baseInputClass =
    'w-full bg-surface border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-fast text-sm';

  return (
    <Modal open={open} onClose={closeModal} labelId={TITLE_ID}>
      <form onSubmit={handleSubmit} noValidate>
        <ModalHeader onClose={closeModal}>
          <ModalTitle id={TITLE_ID}>New issue</ModalTitle>
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
              className={`${baseInputClass} ${titleError ? 'border-error ring-1 ring-error focus:ring-error/50' : ''}`}
              type="text"
              maxLength={TITLE_MAX}
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
              required
            />
            {(titleError || title.length > TITLE_MAX - 50) && (
              <div className="flex justify-between mt-1">
                <span className={titleError ? errorClass : hintClass} role="alert">
                  {titleError || '\u00a0'}
                </span>
                <span className={hintClass}>{title.length} / {TITLE_MAX}</span>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="input-description" className={labelClass}>
              Description
            </label>
            <textarea
              id="input-description"
              className={`${baseInputClass} min-h-[72px] resize-none`}
              rows={3}
              placeholder="Add a description…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Type — chip group per wireframe S-05 */}
          <div>
            <span className={labelClass}>
              Type <span className="text-error">*</span>
            </span>
            <div
              role="group"
              aria-label="Issue type"
              className="flex gap-2 flex-wrap mt-1.5"
            >
              {TYPES.map(({ id: t, label }) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  onClick={() => setType(t)}
                  className={`px-3 py-1.5 rounded-full border text-sm font-medium cursor-pointer transition-all duration-fast focus:outline-none focus:ring-2 focus:ring-primary/50 capitalize ${
                    type === t
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-primary/40 hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {typeError && (
              <span className={errorClass} role="alert">{typeError}</span>
            )}
          </div>

          {/* Priority, epic and due date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="input-priority" className={labelClass}>Priority</label>
              <select
                id="input-priority"
                className={baseInputClass}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="input-epic" className={labelClass}>Epic</label>
              <select
                id="input-epic"
                className={baseInputClass}
                value={type === 'epic' ? '' : epicId}
                disabled={type === 'epic'}
                onChange={(e) => setEpicId(e.target.value)}
              >
                <option value="">None</option>
                {epics.map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="input-due" className={labelClass}>Due date</label>
              <input
                id="input-due"
                className={baseInputClass}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Assignee and labels */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <div>
              <label htmlFor="input-assigned" className={labelClass}>
                Assignee
              </label>
              <AssigneeSelect id="input-assigned" className={baseInputClass} value={assigned} onChange={setAssigned} />
            </div>
            <div>
              <label htmlFor="input-labels" className={labelClass}>Labels</label>
              <LabelsInput id="input-labels" labels={labels} onChange={setLabels} inputClassName={baseInputClass} />
            </div>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={closeModal}>
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
              'Create issue'
            )}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
