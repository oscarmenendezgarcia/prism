/**
 * Labels as chips: type one and press Enter or a comma, remove with its ×.
 */

import React, { useState } from 'react';

const LABEL_MAX = 40;
const LABELS_MAX = 20;

interface LabelsInputProps {
  labels: string[];
  onChange: (labels: string[]) => void;
  disabled?: boolean;
  inputClassName?: string;
  chipsClassName?: string;
  id?: string;
}

export function LabelsInput({ labels, onChange, disabled, inputClassName = '', chipsClassName = '', id }: LabelsInputProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const typed = draft.split(',').map((l) => l.trim().slice(0, LABEL_MAX)).filter(Boolean);
    setDraft('');
    const next = [...new Set([...labels, ...typed])].slice(0, LABELS_MAX);
    if (next.length !== labels.length) onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="labels-input">
      {labels.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${chipsClassName}`}>
          {labels.map((label) => (
            <span key={label} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-surface-variant text-text-secondary">
              {label}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove label ${label}`}
                onClick={() => onChange(labels.filter((l) => l !== label))}
                className="text-text-disabled hover:text-error disabled:opacity-40 transition-colors duration-fast"
              >
                <span className="material-symbols-outlined text-xs leading-none" aria-hidden="true">close</span>
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        type="text"
        value={draft}
        disabled={disabled}
        maxLength={LABEL_MAX}
        placeholder="Add a label…"
        aria-label="Add a label"
        className={inputClassName}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}
