/**
 * AddAttachmentForm — inline form for adding user-owned attachments.
 *
 * QOL-7: renders inside the TaskDetailPanel right sidebar.
 * Three attachment types: link (https URL), text (inline note), file (absolute path).
 * No modal layers — expands inline below the attachment list.
 *
 * Design spec: wireframes.md § S-2 / S-2b.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttachmentType = 'link' | 'text' | 'file';

interface AddAttachmentFormProps {
  /** Task ID to attach to. */
  taskId: string;
  /** Names already on the task — used for name-conflict detection. */
  existingNames: string[];
  /** When true, all inputs are disabled (isReadOnly from parent). */
  disabled: boolean;
  /** Called after a successful add. Parent should close the form. */
  onSuccess: () => void;
  /** Called when the user cancels. Parent should close the form. */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateContent(type: AttachmentType, content: string): string | null {
  if (!content.trim()) return 'Content is required.';

  if (type === 'link') {
    if (!content.startsWith('https://')) {
      return 'URL must start with https://';
    }
    try {
      const url = new URL(content);
      if (url.protocol !== 'https:') {
        return 'URL must use the https:// scheme.';
      }
    } catch {
      return 'Enter a valid https:// URL.';
    }
  }

  if (type === 'file') {
    if (!content.startsWith('/')) {
      return 'File path must be an absolute path starting with /.';
    }
  }

  return null;
}

function validateName(name: string, existingNames: string[]): string | null {
  if (!name.trim()) return 'Name is required.';
  if (name.trim().length > 100) return 'Name must be 100 characters or fewer.';
  if (existingNames.includes(name.trim())) {
    return `"${name.trim()}" already exists on this task. Choose a different name.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Type selector tab
// ---------------------------------------------------------------------------

interface TypeTabProps {
  value: AttachmentType;
  current: AttachmentType;
  icon: string;
  label: string;
  disabled: boolean;
  onClick: (v: AttachmentType) => void;
}

function TypeTab({ value, current, icon, label, disabled, onClick }: TypeTabProps) {
  const isActive = value === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      disabled={disabled}
      onClick={() => onClick(value)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium rounded-md transition-all duration-[160ms] ease-spring focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 disabled:cursor-not-allowed ${
        isActive
          ? 'bg-primary/15 text-primary border border-primary/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant border border-transparent'
      }`}
    >
      <span className="material-symbols-outlined text-[13px] leading-none" aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddAttachmentForm({
  taskId,
  existingNames,
  disabled,
  onSuccess,
  onCancel,
}: AddAttachmentFormProps): React.ReactElement {
  const addUserAttachment = useAppStore((s) => s.addUserAttachment);

  const [type, setType]       = useState<AttachmentType>('link');
  const [name, setName]       = useState('');
  const [content, setContent] = useState('');
  const [nameError, setNameError]       = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);

  // Focus the first field when the form mounts.
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
    });
  }, []);

  // Clear errors and reset content when type changes.
  const handleTypeChange = useCallback((newType: AttachmentType) => {
    setType(newType);
    setContent('');
    setContentError(null);
    // Keep name (user may have typed one already).
  }, []);

  // Auto-populate name from URL hostname on content blur when name is empty.
  const handleContentBlur = useCallback(() => {
    if (type !== 'link' || name.trim() || !content) return;
    try {
      const url = new URL(content);
      setName(url.hostname);
    } catch {
      // Not a valid URL yet — skip auto-populate.
    }
  }, [type, name, content]);

  const contentLabel = type === 'link' ? 'URL' : type === 'text' ? 'Content' : 'Path';
  const contentPlaceholder =
    type === 'link'
      ? 'https://example.com'
      : type === 'text'
      ? 'Type your note here…'
      : '/absolute/path/to/file';

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (disabled || saving) return;

      // Run all validations before making any API call.
      const nErr = validateName(name, existingNames);
      const cErr = validateContent(type, content);

      setNameError(nErr);
      setContentError(cErr);

      if (nErr || cErr) return;

      setSaving(true);
      try {
        await addUserAttachment(taskId, {
          name: name.trim(),
          type,
          content: content.trim(),
        });
        onSuccess();
      } catch {
        // addUserAttachment already shows a toast on error — no extra handling needed.
      } finally {
        setSaving(false);
      }
    },
    [disabled, saving, name, existingNames, type, content, addUserAttachment, taskId, onSuccess],
  );

  // Escape key → cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <form
      role="form"
      aria-label="Add attachment"
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 pt-2"
    >
      {/* Type selector */}
      <div role="group" aria-label="Attachment type" className="flex gap-1">
        <TypeTab
          value="link"
          current={type}
          icon="link"
          label="Link"
          disabled={disabled}
          onClick={handleTypeChange}
        />
        <TypeTab
          value="text"
          current={type}
          icon="notes"
          label="Note"
          disabled={disabled}
          onClick={handleTypeChange}
        />
        <TypeTab
          value="file"
          current={type}
          icon="folder_open"
          label="File Path"
          disabled={disabled}
          onClick={handleTypeChange}
        />
      </div>

      {/* Name field */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">
          Name
        </label>
        <input
          ref={firstFieldRef}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          disabled={disabled || saving}
          aria-invalid={nameError !== null}
          aria-describedby={nameError ? 'name-error' : undefined}
          placeholder="e.g. GitHub PR"
          className="w-full h-9 px-3 rounded-lg bg-surface/60 border border-border/40 text-sm text-text-primary placeholder:text-text-disabled/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[200ms] ease-spring shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
        />
        {nameError && (
          <p id="name-error" role="alert" className="text-[11px] text-error leading-snug">
            {nameError}
          </p>
        )}
      </div>

      {/* Content field — label + input changes per type */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">
          {contentLabel}
        </label>
        {type === 'text' ? (
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (contentError) setContentError(null);
            }}
            disabled={disabled || saving}
            aria-invalid={contentError !== null}
            aria-describedby={contentError ? 'content-error' : undefined}
            placeholder={contentPlaceholder}
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-surface/60 border border-border/40 text-sm text-text-primary placeholder:text-text-disabled/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[200ms] ease-spring shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] resize-none"
          />
        ) : (
          <input
            type={type === 'link' ? 'url' : 'text'}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (contentError) setContentError(null);
            }}
            onBlur={handleContentBlur}
            disabled={disabled || saving}
            aria-invalid={contentError !== null}
            aria-describedby={contentError ? 'content-error' : undefined}
            placeholder={contentPlaceholder}
            className="w-full h-9 px-3 rounded-lg bg-surface/60 border border-border/40 text-sm text-text-primary placeholder:text-text-disabled/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[200ms] ease-spring shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          />
        )}
        {contentError && (
          <p id="content-error" role="alert" className="text-[11px] text-error leading-snug">
            {contentError}
          </p>
        )}
      </div>

      {/* Footer buttons */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
          className="text-xs px-3 py-1.5"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || saving}
          className="text-xs px-3 py-1.5 min-w-[3rem]"
        >
          {saving ? (
            <span className="material-symbols-outlined text-[14px] leading-none animate-spin" aria-hidden="true">
              progress_activity
            </span>
          ) : (
            'Add'
          )}
        </Button>
      </div>
    </form>
  );
}
