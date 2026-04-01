/**
 * TaggerReviewModal — review AI-generated card classification suggestions.
 *
 * ADR-1 (Tagger Agent): each suggestion row shows current type → inferred type
 * with an accept/reject toggle. LOW confidence rows start pre-rejected.
 * Apply calls PUT /tasks/:id for each accepted suggestion sequentially.
 *
 * Design reference: agent-docs/tagger-agent/stitch-screens/tagger-review-modal.html
 * Token mapping per wireframes-stitch.md §Notas de adaptación:
 *   surface-dim  → bg-surface
 *   surface-container-high → bg-surface-elevated
 *   on-surface   → text-text-primary
 *   outline-variant → border-border
 *   primary      → text-primary / bg-primary
 */

import React, { useState, useCallback } from 'react';
import { Modal, ModalHeader, ModalTitle } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';
import type { TaggerSuggestion } from '@/types';

// ---------------------------------------------------------------------------
// Type badge colour map (matches Badge component intent but inlined for
// the "from → to" pattern without changing Badge API)
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  feature:    { bg: 'bg-[#6C39C0]/10',   text: 'text-[#6C39C0]' },
  bug:        { bg: 'bg-[#FF3B30]/10',   text: 'text-[#FF3B30]' },
  'tech-debt': { bg: 'bg-[#E65100]/10',  text: 'text-[#E65100]' },
  chore:      { bg: 'bg-surface-variant', text: 'text-text-secondary' },
  unknown:    { bg: 'bg-surface-variant', text: 'text-text-secondary' },
};

function TypeBadge({ type, dim = false }: { type: string; dim?: boolean }) {
  const colors = TYPE_COLORS[type] ?? TYPE_COLORS.unknown;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${colors.bg} ${colors.text} ${dim ? 'opacity-60' : ''}`}
    >
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Confidence dots — 3 dots, filled according to level
// ---------------------------------------------------------------------------

const CONFIDENCE_DOT_COLORS = {
  high:   ['bg-[#34C759]', 'bg-[#34C759]', 'bg-[#34C759]'],
  medium: ['bg-[#FF9500]', 'bg-[#FF9500]', 'bg-surface-variant'],
  low:    ['bg-[#FF3B30]', 'bg-surface-variant', 'bg-surface-variant'],
} as const;

const CONFIDENCE_LABELS = { high: 'HIGH', medium: 'MED', low: 'LOW' } as const;

function ConfidenceDots({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const dots  = CONFIDENCE_DOT_COLORS[confidence] ?? CONFIDENCE_DOT_COLORS.low;
  const label = CONFIDENCE_LABELS[confidence] ?? 'LOW';
  return (
    <div className="flex gap-1 items-center shrink-0">
      <div className="flex gap-0.5">
        {dots.map((cls, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full ${cls}`} />
        ))}
      </div>
      <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest ml-1">
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
        checked ? 'bg-primary' : 'bg-surface-variant'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-on-primary shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0 bg-text-secondary'
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Suggestion row
// ---------------------------------------------------------------------------

interface SuggestionRowProps {
  suggestion: TaggerSuggestion;
  accepted: boolean;
  onToggle: (id: string, value: boolean) => void;
  error?: string;
}

function SuggestionRow({ suggestion, accepted, onToggle, error }: SuggestionRowProps) {
  const isLow      = suggestion.confidence === 'low';
  const hasImproved = suggestion.description !== undefined;

  return (
    <>
      <div
        className={`px-6 py-4 flex items-center gap-4 transition-colors ${
          isLow
            ? 'bg-[#FF9500]/5 border-l-2 border-[#FF3B30]'
            : 'hover:bg-surface-elevated/40'
        }`}
      >
        {/* Toggle */}
        <div className="w-11 h-11 flex items-center justify-center shrink-0">
          <ToggleSwitch
            checked={accepted}
            onChange={(v) => onToggle(suggestion.id, v)}
            ariaLabel={`${accepted ? 'Reject' : 'Accept'} suggestion for "${suggestion.title}"`}
          />
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <span className="text-[14px] text-text-primary font-medium leading-none truncate">
            {suggestion.title}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={suggestion.currentType} dim />
            <span
              className="material-symbols-outlined text-[14px] text-text-secondary"
              aria-hidden="true"
            >
              arrow_forward
            </span>
            <TypeBadge type={suggestion.inferredType} />
          </div>

          {/* Description diff — only when improveDescriptions was true */}
          {hasImproved && (
            <p className="text-[12px] text-text-secondary mt-1 line-clamp-2">
              {suggestion.description}
            </p>
          )}

          {/* Per-card error */}
          {error && (
            <p className="text-[12px] text-[#FF3B30] mt-0.5">{error}</p>
          )}
        </div>

        {/* Confidence */}
        <ConfidenceDots confidence={suggestion.confidence} />
      </div>
      <div className="h-px bg-border/10 mx-6" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function TaggerReviewModal() {
  const suggestions    = useAppStore((s) => s.taggerSuggestions);
  const modalOpen      = useAppStore((s) => s.taggerModalOpen);
  const closeTagger    = useAppStore((s) => s.closeTagger);
  const loadBoard      = useAppStore((s) => s.loadBoard);
  const showToast      = useAppStore((s) => s.showToast);
  const activeSpaceId  = useAppStore((s) => s.activeSpaceId);

  // Per-row accepted state — LOW confidence starts pre-rejected
  const [accepted, setAccepted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      suggestions.map((s) => [s.id, s.confidence !== 'low'])
    )
  );
  const [applying, setApplying]     = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  // Re-initialise accepted state when suggestions change (modal re-opens)
  React.useEffect(() => {
    if (modalOpen) {
      setAccepted(
        Object.fromEntries(
          suggestions.map((s) => [s.id, s.confidence !== 'low'])
        )
      );
      setCardErrors({});
      setApplyProgress(0);
    }
  }, [modalOpen, suggestions]);

  const acceptedSuggestions = suggestions.filter((s) => accepted[s.id]);
  const acceptedCount = acceptedSuggestions.length;

  const handleToggle = useCallback((id: string, value: boolean) => {
    setAccepted((prev) => ({ ...prev, [id]: value }));
  }, []);

  async function handleApply() {
    if (applying || acceptedCount === 0) return;
    setApplying(true);
    setApplyProgress(0);
    const errors: Record<string, string> = {};

    for (let i = 0; i < acceptedSuggestions.length; i++) {
      const s = acceptedSuggestions[i];
      try {
        await api.updateTask(activeSpaceId, s.id, {
          type: s.inferredType,
          ...(s.description !== undefined ? { description: s.description } : {}),
        });
      } catch (err) {
        errors[s.id] = (err as Error).message || 'Failed to update';
      }
      setApplyProgress(i + 1);
    }

    setCardErrors(errors);

    const failedCount = Object.keys(errors).length;
    const appliedCount = acceptedSuggestions.length - failedCount;

    await loadBoard();

    if (failedCount === 0) {
      showToast(`Applied ${appliedCount} type update${appliedCount !== 1 ? 's' : ''}.`, 'success');
      closeTagger();
    } else {
      showToast(`${appliedCount} applied, ${failedCount} failed. See details below.`, 'error');
      setApplying(false);
    }
  }

  function handleCancel() {
    closeTagger();
  }

  const modelShortName = suggestions.length > 0
    ? 'claude-3-5-sonnet'
    : '';

  return (
    <Modal
      open={modalOpen}
      onClose={handleCancel}
      labelId="tagger-modal-title"
      className="max-w-[640px]"
    >
      {/* Header */}
      <ModalHeader onClose={handleCancel}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className="material-symbols-outlined text-primary text-xl"
              aria-hidden="true"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              colors_spark
            </span>
            <ModalTitle id="tagger-modal-title">Auto-tag suggestions</ModalTitle>
            {modelShortName && (
              <span className="ml-2 px-2 py-0.5 bg-surface-variant text-text-secondary text-[11px] font-medium rounded-md uppercase tracking-wider">
                {modelShortName}
              </span>
            )}
          </div>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {suggestions.length === 0
              ? 'No suggestions — all cards are already correctly typed.'
              : `${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </ModalHeader>

      {/* Body */}
      <div className="flex-1 overflow-y-auto border-t border-border/10 max-h-[50vh]">
        {suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-secondary gap-3">
            <span className="material-symbols-outlined text-4xl" aria-hidden="true">
              check_circle
            </span>
            <p className="text-[14px]">All cards are already correctly typed.</p>
          </div>
        ) : (
          suggestions.map((s) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              accepted={accepted[s.id] ?? false}
              onToggle={handleToggle}
              error={cardErrors[s.id]}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {suggestions.length > 0 && (
        <div className="px-6 py-5 border-t border-border/10 flex items-center justify-between">
          <Button variant="ghost" onClick={handleCancel} disabled={applying}>
            Cancel
          </Button>

          <div className="flex items-center gap-3">
            {applying && (
              <span className="text-[13px] text-text-secondary">
                Applying {applyProgress} of {acceptedCount}…
              </span>
            )}
            <Button
              variant="primary"
              onClick={handleApply}
              disabled={applying || acceptedCount === 0}
              aria-busy={applying}
            >
              {applying ? (
                <>
                  <span
                    className="material-symbols-outlined text-base animate-spin"
                    aria-hidden="true"
                  >
                    progress_activity
                  </span>
                  Applying…
                </>
              ) : (
                `Apply selected (${acceptedCount})`
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
