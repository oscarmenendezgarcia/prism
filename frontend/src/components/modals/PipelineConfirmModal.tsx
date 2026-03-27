/**
 * Pipeline confirm modal — shown when the user clicks "Run Pipeline" on a task card.
 * Allows removing, reordering, and adding checkpoints per stage before launching.
 *
 * T-2: Pipeline editable por card.
 * T-3: "Pause before this stage" checkbox per stage (manual checkpoints).
 * T-4: "Use orchestrator mode" toggle at the bottom — routes to executeOrchestratorRun.
 */

import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';
import type { PipelineStage } from '@/types';

const TITLE_ID = 'pipeline-confirm-title';

const STAGE_ICON: Record<string, string> = {
  'senior-architect':  'architecture',
  'ux-api-designer':   'palette',
  'developer-agent':   'code',
  'qa-engineer-e2e':   'bug_report',
};

export function PipelineConfirmModal() {
  const modal                 = useAppStore((s) => s.pipelineConfirmModal);
  const closePipeline         = useAppStore((s) => s.closePipelineConfirm);
  const startPipeline         = useAppStore((s) => s.startPipeline);
  const executeOrchestratorRun = useAppStore((s) => s.executeOrchestratorRun);
  const templates      = useAppStore((s) => s.templates);
  const saveTemplate   = useAppStore((s) => s.saveTemplate);
  const delTemplate    = useAppStore((s) => s.deleteTemplate);
  const spaces          = useAppStore((s) => s.spaces);
  const availableAgents = useAppStore((s) => s.availableAgents);
  const loadAgents      = useAppStore((s) => s.loadAgents);

  const [stages, setStages]               = useState<PipelineStage[]>([]);
  /** T-3: Set of stage indices (0-based) where pipeline should pause before executing. */
  const [checkpoints, setCheckpoints]     = useState<Set<number>>(new Set());
  /** T-4: When true, routes to executeOrchestratorRun instead of startPipeline. */
  const [useOrchestrator, setUseOrchestrator] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName]     = useState('');
  const [showSaveForm, setShowSaveForm]     = useState(false);

  const isOpen = modal?.open ?? false;

  // Sync stages from modal when it opens; reset local state. Load agents if needed.
  useEffect(() => {
    if (isOpen && modal) {
      setStages([...modal.stages]);
      setCheckpoints(new Set(modal.checkpoints ?? []));
      setUseOrchestrator(modal.useOrchestratorMode ?? false);
      const space = spaces.find((s) => s.id === modal.spaceId);
      loadAgents(space?.workingDirectory);
    }
  }, [isOpen, modal]);

  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...stages];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    // Remap checkpoints: swap indices i-1 and i.
    setCheckpoints((prev) => {
      const next2 = new Set<number>();
      prev.forEach((c) => {
        if (c === i - 1)     next2.add(i);
        else if (c === i)    next2.add(i - 1);
        else                 next2.add(c);
      });
      return next2;
    });
    setStages(next);
  }

  function moveDown(i: number) {
    if (i === stages.length - 1) return;
    const next = [...stages];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    // Remap checkpoints: swap indices i and i+1.
    setCheckpoints((prev) => {
      const next2 = new Set<number>();
      prev.forEach((c) => {
        if (c === i)     next2.add(i + 1);
        else if (c === i + 1) next2.add(i);
        else             next2.add(c);
      });
      return next2;
    });
    setStages(next);
  }

  function remove(i: number) {
    setStages(stages.filter((_, j) => j !== i));
    // Remap checkpoints: remove index i, shift down all indices > i.
    setCheckpoints((prev) => {
      const next2 = new Set<number>();
      prev.forEach((c) => {
        if (c < i)  next2.add(c);
        if (c > i)  next2.add(c - 1);
        // c === i: removed, not re-added
      });
      return next2;
    });
  }

  function toggleCheckpoint(i: number) {
    setCheckpoints((prev) => {
      const next2 = new Set(prev);
      if (next2.has(i)) {
        next2.delete(i);
      } else {
        next2.add(i);
      }
      return next2;
    });
  }

  async function handleRun() {
    if (!modal || stages.length === 0) return;
    closePipeline();

    if (useOrchestrator) {
      await executeOrchestratorRun(modal.spaceId, modal.taskId, stages);
    } else {
      await startPipeline(modal.spaceId, modal.taskId, stages, Array.from(checkpoints).sort((a, b) => a - b));
    }
  }

  return (
    <Modal open={isOpen} onClose={closePipeline} labelId={TITLE_ID}>
      <ModalHeader onClose={closePipeline}>
        <ModalTitle id={TITLE_ID}>Run Pipeline</ModalTitle>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-3">
        {templates.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-disabled flex-shrink-0">Load template:</span>
            <select
              className="flex-1 text-xs px-2 py-1 bg-surface-variant border border-border rounded text-text-primary focus:outline-none focus:border-primary"
              defaultValue=""
              onChange={(e) => {
                const tmpl = templates.find((t) => t.id === e.target.value);
                if (!tmpl) return;
                setStages([...tmpl.stages] as PipelineStage[]);
                setCheckpoints(new Set(
                  tmpl.checkpoints
                    .map((v, i) => (v ? i : -1))
                    .filter((i) => i >= 0)
                ));
                setUseOrchestrator(tmpl.useOrchestratorMode);
                e.target.value = '';
              }}
              aria-label="Load pipeline template"
            >
              <option value="" disabled>Select a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}
        <p className="text-sm text-text-secondary">
          Review and adjust the stages before running. Use arrows to reorder, remove stages you don't need, or pause before any stage.
        </p>

        {stages.length === 0 ? (
          <p className="text-sm text-error text-center py-4">Add at least one stage to run.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {stages.map((stage, i) => (
              <li
                key={stage + i}
                className="flex flex-col gap-1.5 bg-surface-variant border border-border rounded-md px-3 py-2"
              >
                {/* Stage row */}
                <div className="flex items-center gap-2">
                  {/* Step number */}
                  <span className="text-[11px] text-text-disabled w-4 text-right flex-shrink-0">{i + 1}</span>

                  {/* Icon */}
                  <span
                    className="material-symbols-outlined text-base text-primary leading-none flex-shrink-0"
                    aria-hidden="true"
                  >
                    {STAGE_ICON[stage] ?? 'smart_toy'}
                  </span>

                  {/* Name */}
                  <span className="text-sm text-text-primary flex-1 truncate">
                    {availableAgents.find((a) => a.id === stage)?.displayName ?? stage}
                  </span>

                  {/* Move up/down */}
                  <div className="flex gap-0.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => moveUp(i)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(i)}
                      disabled={i === stages.length - 1}
                      aria-label="Move down"
                      className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      ↓
                    </button>
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="Remove stage"
                    className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-error hover:bg-error/10 transition-colors flex-shrink-0 text-sm"
                  >
                    ✕
                  </button>
                </div>

                {/* T-3: "Pause before this stage" checkbox — hidden in orchestrator mode */}
                {!useOrchestrator && (
                  <label className="flex items-center gap-2 cursor-pointer pl-6">
                    <input
                      type="checkbox"
                      checked={checkpoints.has(i)}
                      onChange={() => toggleCheckpoint(i)}
                      aria-label={`Pause before stage ${i + 1}: ${availableAgents.find((a) => a.id === stage)?.displayName ?? stage}`}
                      className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    />
                    <span className="text-[11px] text-text-secondary select-none">
                      Pause before this stage
                    </span>
                    {checkpoints.has(i) && (
                      <span
                        className="material-symbols-outlined text-xs text-warning leading-none"
                        aria-hidden="true"
                        title="Pipeline will pause and wait for confirmation"
                      >
                        pause_circle
                      </span>
                    )}
                  </label>
                )}
              </li>
            ))}
          </ol>
        )}

        {/* Add stage selector */}
        {availableAgents.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="flex-1 text-xs px-2 py-1.5 bg-surface-variant border border-border rounded text-text-primary focus:outline-none focus:border-primary"
              value=""
              onChange={(e) => {
                const agentId = e.target.value;
                if (!agentId) return;
                setStages((prev) => [...prev, agentId as PipelineStage]);
                e.target.value = '';
              }}
              aria-label="Add stage"
            >
              <option value="">+ Add stage…</option>
              {availableAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.displayName}</option>
              ))}
            </select>
          </div>
        )}

        {/* Arrow connector hint */}
        {stages.length > 1 && (
          <p className="text-[11px] text-text-disabled text-center">
            {stages.map((s) => availableAgents.find((a) => a.id === s)?.displayName ?? s).join(' → ')}
          </p>
        )}

        {/* Save as template */}
        <div className="border-t border-border pt-3">
          {!showSaveForm ? (
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              + Save as template
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-text-secondary font-medium">Save as template</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name…"
                  maxLength={100}
                  className="flex-1 text-xs px-2 py-1.5 bg-surface-variant border border-border rounded text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-primary"
                  aria-label="Template name"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={savingTemplate || !templateName.trim()}
                  onClick={async () => {
                    if (!templateName.trim()) return;
                    setSavingTemplate(true);
                    try {
                      const cpArray = stages.map((_, i) => checkpoints.has(i));
                      await saveTemplate(templateName.trim(), [...stages], cpArray, useOrchestrator);
                      setTemplateName("");
                      setShowSaveForm(false);
                    } finally {
                      setSavingTemplate(false);
                    }
                  }}
                >
                  {savingTemplate ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setShowSaveForm(false); setTemplateName(""); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* T-4: Orchestrator mode toggle */}
        <div className="border-t border-border pt-3 mt-1">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useOrchestrator}
              onChange={(e) => setUseOrchestrator(e.target.checked)}
              aria-label="Use orchestrator mode"
              className="mt-0.5 w-4 h-4 rounded border-border accent-primary cursor-pointer flex-shrink-0"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-text-primary font-medium select-none">
                Orchestrator mode
              </span>
              <span className="text-[11px] text-text-secondary select-none">
                Launch all stages via a meta-agent that manages sub-agents with shared context. Checkpoints are handled internally by the orchestrator.
              </span>
            </div>
          </label>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="secondary" onClick={closePipeline}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={stages.length === 0}
          onClick={handleRun}
        >
          {useOrchestrator ? (
            <>
              <span className="material-symbols-outlined text-base leading-none mr-1" aria-hidden="true">
                hub
              </span>
              Run Orchestrator
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-base leading-none mr-1" aria-hidden="true">
                play_arrow
              </span>
              Run {stages.length} stage{stages.length !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
