/**
 * AddAttachmentForm — inline form for attaching a file to a task.
 *
 * Files only: pick a file with the same DirectoryPicker used for the space
 * working directory (mode="file"), or type an absolute path. The attachment name
 * IS the file's basename — there is no separate name field. No modal layers —
 * expands inline below the attachment list.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import { DirectoryPicker } from '@/components/shared/DirectoryPicker';

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

/** Last path segment, e.g. /a/b/file.md → file.md */
function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? '';
}

const inputClass =
  'w-full bg-surface border border-border rounded-lg px-3 h-[46px] text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-[border-color,box-shadow] duration-fast disabled:opacity-40 disabled:cursor-not-allowed';

export function AddAttachmentForm({
  taskId,
  existingNames,
  disabled,
  onSuccess,
  onCancel,
}: AddAttachmentFormProps): React.ReactElement {
  const addUserAttachment = useAppStore((s) => s.addUserAttachment);

  const [path, setPath]   = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pathInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => pathInputRef.current?.focus());
  }, []);

  const handlePathChange = useCallback((p: string) => {
    setPath(p);
    setError(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (disabled || saving) return;

      const p = path.trim();
      if (!p) { setError('Pick a file or enter an absolute path.'); return; }
      if (!p.startsWith('/')) { setError('Path must be absolute (start with /).'); return; }

      // The attachment name is the file's basename.
      const name = basename(p);
      if (existingNames.includes(name)) {
        setError(`"${name}" is already attached to this task.`);
        return;
      }

      setSaving(true);
      try {
        await addUserAttachment(taskId, { name, type: 'file', content: p });
        onSuccess();
      } catch {
        // addUserAttachment shows a toast on error.
      } finally {
        setSaving(false);
      }
    },
    [disabled, saving, path, existingNames, addUserAttachment, taskId, onSuccess],
  );

  // Escape → cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <form role="form" aria-label="Add attachment" onSubmit={handleSubmit} className="flex flex-col gap-3 pt-2 animate-fade-in-up">
      {/* File picker — same DirectoryPicker as the space working directory, file mode */}
      <div className="flex flex-col gap-1">
        <label htmlFor="attach-path" className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">
          File
        </label>
        <div data-dir-picker-anchor className="flex gap-2 items-start">
          <input
            id="attach-path"
            ref={pathInputRef}
            type="text"
            value={path}
            onChange={(e) => handlePathChange(e.target.value)}
            disabled={disabled || saving}
            aria-invalid={error !== null}
            aria-describedby={error ? 'attach-error' : undefined}
            placeholder="/absolute/path/to/file"
            className={`${inputClass} flex-1 min-w-0`}
          />
          <DirectoryPicker
            value={path}
            onChange={handlePathChange}
            mode="file"
            buttonLabel="Browse for file"
            disabled={disabled || saving}
          />
        </div>
        {error && (
          <p id="attach-error" role="alert" className="text-[11px] text-error leading-snug">
            {error}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving} className="text-xs px-3 py-1.5">
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={disabled || saving} className="text-xs px-3 py-1.5 min-w-[3rem]">
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
