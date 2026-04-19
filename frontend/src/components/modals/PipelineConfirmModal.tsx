/**
 * Pipeline confirm modal — shown when the user clicks "Run Pipeline" on a task card.
 * Allows removing, reordering, and adding checkpoints per stage before launching.
 *
 * T-2: Pipeline editable por card.
 * T-3: "Pause before this stage" checkbox per stage (manual checkpoints).
 * T-4: "Use orchestrator mode" toggle at the bottom — routes to executeOrchestratorRun.
 * T-9: "Preview Prompts" button — calls POST /api/v1/runs/preview-prompts and shows
 *       each stage's prompt in a collapsible section below the stage row.
 */

import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { useAppStore } from '@/stores/useAppStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { previewPipelinePrompts } from '@/api/client';
import type { PipelineStage, PipelinePromptPreviewEntry } from '@/types';

const TITLE_ID = 'pipeline-confirm-title';

const STAGE_ICON: Record<string, string> = {
  'senior-architect':  'architecture',
  'ux-api-designer':   'palette',
  'developer-agent':   'code',
  'qa-engineer-e2e':   'bug_report',
};

/** Agent color token class (matches --color-agent-* in index.css). */
const STAGE_COLOR_CLASS: Record<string, string> = {
  'senior-architect': 'text-agent-architect',
  'ux-api-designer':  'text-agent-ux',
  'developer-agent':  'text-agent-dev',
  'qa-engineer-e2e':  'text-agent-qa',
};

const STAGE_BG_CLASS: Record<string, string> = {
  'senior-architect': 'bg-agent-architect/10',
  'ux-api-designer':  'bg-agent-ux/10',
  'developer-agent':  'bg-agent-dev/10',
  'qa-engineer-e2e':  'bg-agent-qa/10',
};

export function PipelineConfirmModal() {
  const modal                 = useAppStore((s) => s.pipelineConfirmModal);
  const closePipeline         = useAppStore((s) => s.closePipelineConfirm);
  const startPipeline         = useAppStore((s) => s.startPipeline);
  const executeOrchestratorRun = useAppStore((s) => s.executeOrchestratorRun);
  const spaces          = useAppStore((s) => s.spaces);
  const availableAgents = useAppStore((s) => s.availableAgents);
  const loadAgents      = useAppStore((s) => s.loadAgents);

  const [stages, setStages]               = useState<PipelineStage[]>([]);
  /** T-3: Set of stage indices (0-based) where pipeline should pause before executing. */
  const [checkpoints, setCheckpoints]     = useState<Set<number>>(new Set());
  /** T-4: When true, routes to executeOrchestratorRun instead of startPipeline. */
  const [useOrchestrator, setUseOrchestrator] = useState(false);
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);

  // True when the active terminal tab has an established PTY connection.
  // Orchestrator mode injects the command into the PTY when one is available;
  // otherwise the run spawns headlessly in the backend, where
  // --dangerously-skip-permissions is always applied automatically.
  const hasActiveTerminal = useTerminalSessionStore((s) => {
    const active = s.sessions.find((sess) => sess.id === s.activeId);
    return active?.sendInput != null;
  });
  // Backend spawn path: native pipeline always; orchestrator only when no terminal.
  const runsInBackend = !useOrchestrator || !hasActiveTerminal;

  // T-9: Preview prompts state.
  /** Null = not yet fetched, array = fetched prompts, 'loading' = in-flight. */
  const [previewPrompts, setPreviewPrompts] = useState<PipelinePromptPreviewEntry[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  /** Index of the currently expanded prompt, or null if all collapsed. */
  const [expandedPromptIndex, setExpandedPromptIndex] = useState<number | null>(null);

  const isOpen = modal?.open ?? false;

  // Sync stages from modal when it opens; reset local state. Load agents if needed.
  useEffect(() => {
    if (isOpen && modal) {
      setStages([...modal.stages]);
      setCheckpoints(new Set(modal.checkpoints ?? []));
      setUseOrchestrator(modal.useOrchestratorMode ?? false);
      setDangerouslySkipPermissions(false);
      // Clear any previously fetched preview prompts when the modal re-opens.
      setPreviewPrompts(null);
      setExpandedPromptIndex(null);
      const space = spaces.find((s) => s.id === modal.spaceId);
      loadAgents(space?.workingDirectory);
    }
  }, [isOpen, modal]);

  /** Clear preview prompt cache whenever stages change (reorder/remove). */
  function invalidatePreviewCache() {
    setPreviewPrompts(null);
    setExpandedPromptIndex(null);
  }

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
    invalidatePreviewCache();
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
    invalidatePreviewCache();
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
    invalidatePreviewCache();
  }

  async function handlePreviewPrompts() {
    if (!modal || stages.length === 0) return;
    setPreviewLoading(true);
    setPreviewPrompts(null);
    setExpandedPromptIndex(null);
    try {
      const result = await previewPipelinePrompts(modal.spaceId, modal.taskId, stages);
      setPreviewPrompts(result.prompts);
      // Auto-expand the first stage prompt.
      setExpandedPromptIndex(0);
    } catch (err) {
      useAppStore.getState().showToast(
        `Failed to preview prompts: ${(err as Error).message}`,
        'error',
      );
    } finally {
      setPreviewLoading(false);
    }
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
      await executeOrchestratorRun(modal.spaceId, modal.taskId, stages, dangerouslySkipPermissions);
    } else {
      await startPipeline(modal.spaceId, modal.taskId, stages, Array.from(checkpoints).sort((a, b) => a - b), dangerouslySkipPermissions);
    }
  }

  return (
    <Modal open={isOpen} onClose={closePipeline} labelId={TITLE_ID}>
      <ModalHeader onClose={closePipeline}>
        <ModalTitle id={TITLE_ID}>Run Pipeline</ModalTitle>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          Review and adjust the stages before running. Use arrows to reorder, remove stages you don't need, or pause before any stage.
        </p>

        {/* Staggered timeline — wireframe S-06 */}
        {stages.length === 0 ? (
          <p className="text-sm text-error text-center py-4">Add at least one stage to run.</p>
        ) : (
          <>
            {/* Horizontal timeline dots */}
            <div className="flex items-start justify-between gap-2 py-4 overflow-x-auto">
              {stages.map((stage, i) => {
                const colorClass = STAGE_COLOR_CLASS[stage] ?? 'text-primary';
                const bgClass = STAGE_BG_CLASS[stage] ?? 'bg-primary/10';
                const displayName = availableAgents.find((a) => a.id === stage)?.displayName ?? stage;
                return (
                  <React.Fragment key={stage + i}>
                    <div
                      className="flex flex-col items-center gap-2 flex-1 min-w-[60px]"
                      style={{ '--stagger-delay': `${i * 40}ms`, animationDelay: 'var(--stagger-delay)' } as React.CSSProperties} // lint-ok: stagger requires dynamic per-index CSS custom property
                    >
                      {/* Agent dot */}
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${bgClass} ${colorClass}`}>
                        <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
                          {STAGE_ICON[stage] ?? 'smart_toy'}
                        </span>
                      </div>
                      {/* Stage name */}
                      <span className={`text-xs font-medium text-center leading-snug ${colorClass}`}>
                        {displayName}
                      </span>
                      {/* Stage number */}
                      <span className="text-[10px] text-text-disabled font-mono">{i + 1}</span>
                    </div>
                    {/* Connector line between stages */}
                    {i < stages.length - 1 && (
                      <div className="flex-shrink-0 h-px w-6 bg-border mt-4 self-start" aria-hidden="true" />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Editable stage list */}
            <ol className="flex flex-col gap-2">
              {stages.map((stage, i) => {
                const colorClass = STAGE_COLOR_CLASS[stage] ?? 'text-primary';
                const bgClass = STAGE_BG_CLASS[stage] ?? 'bg-primary/10';
                return (
                  <li
                    key={stage + i}
                    className="flex flex-col gap-1.5 bg-surface-elevated border border-border rounded-lg px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-md flex-shrink-0 ${bgClass}`}>
                        <span className={`material-symbols-outlined text-sm leading-none ${colorClass}`} aria-hidden="true">
                          {STAGE_ICON[stage] ?? 'smart_toy'}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-disabled font-mono flex-shrink-0">{i + 1}</span>
                      <span className={`text-sm font-medium flex-1 truncate ${colorClass}`}>
                        {availableAgents.find((a) => a.id === stage)?.displayName ?? stage}
                      </span>
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
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        aria-label="Remove stage"
                        className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-error hover:bg-error/10 transition-colors flex-shrink-0 text-sm"
                      >
                        ✕
                      </button>
                    </div>

                    {/* T-3: pause checkpoint */}
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
                          <span className="material-symbols-outlined text-xs text-warning leading-none" aria-hidden="true" title="Pipeline will pause">
                            pause_circle
                          </span>
                        )}
                      </label>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {/* Add stage selector */}
        {availableAgents.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="flex-1 text-xs px-2 py-1.5 bg-surface-variant border border-border rounded text-text-primary focus:outline-hidden focus:border-primary"
              value=""
              onChange={(e) => {
                const agentId = e.target.value;
                if (!agentId) return;
                setStages((prev) => [...prev, agentId as PipelineStage]);
                invalidatePreviewCache();
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

        {/* T-9: Preview Prompts button + collapsible prompt sections */}
        {stages.length > 0 && (
          <div className="border-t border-border pt-3 mt-1 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handlePreviewPrompts}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <>
                    <span className="material-symbols-outlined text-sm leading-none animate-spin mr-1" aria-hidden="true">
                      progress_activity
                    </span>
                    Loading…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm leading-none mr-1" aria-hidden="true">
                      visibility
                    </span>
                    Preview Prompts
                  </>
                )}
              </Button>
              {previewPrompts && (
                <button
                  type="button"
                  onClick={() => { setPreviewPrompts(null); setExpandedPromptIndex(null); }}
                  className="text-xs text-text-secondary hover:text-primary transition-colors"
                >
                  Hide
                </button>
              )}
            </div>

            {previewPrompts && previewPrompts.map((entry) => (
              <div key={entry.stageIndex} className="border border-border rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedPromptIndex(
                    expandedPromptIndex === entry.stageIndex ? null : entry.stageIndex
                  )}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs bg-surface-variant hover:bg-surface transition-colors"
                  aria-expanded={expandedPromptIndex === entry.stageIndex}
                >
                  <span className="font-medium text-text-primary">
                    {entry.stageIndex + 1}. {availableAgents.find((a) => a.id === entry.agentId)?.displayName ?? entry.agentId}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-text-disabled">
                      ~{entry.estimatedTokens >= 1000
                        ? `${(entry.estimatedTokens / 1000).toFixed(1)}k`
                        : entry.estimatedTokens} tokens
                    </span>
                    <span className="material-symbols-outlined text-sm text-text-secondary leading-none" aria-hidden="true">
                      {expandedPromptIndex === entry.stageIndex ? 'expand_less' : 'expand_more'}
                    </span>
                  </div>
                </button>
                {expandedPromptIndex === entry.stageIndex && (
                  <div className="max-h-48 overflow-y-auto p-3 bg-surface text-xs font-mono text-text-primary border-t border-border whitespace-pre-wrap">
                    {entry.promptFull}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* T-4: Orchestrator mode toggle */}
        <div className="border-t border-border pt-3 mt-1 flex flex-col gap-3">
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

          {runsInBackend ? (
            <div className="flex items-start gap-2 rounded-md bg-surface-variant border border-border px-3 py-2">
              <span className="material-symbols-outlined text-sm text-text-secondary leading-tight mt-0.5 flex-shrink-0" aria-hidden="true">info</span>
              <span className="text-[11px] text-text-secondary select-none">
                The pipeline runs in the background.{' '}
                <code className="font-mono bg-surface px-0.5 rounded">--dangerously-skip-permissions</code>{' '}
                is applied automatically — with no active terminal there is no one to respond to permission prompts.
              </span>
            </div>
          ) : (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={dangerouslySkipPermissions}
                onChange={(e) => setDangerouslySkipPermissions(e.target.checked)}
                aria-label="Skip permission prompts"
                className="mt-0.5 w-4 h-4 rounded border-border accent-warning cursor-pointer flex-shrink-0"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-text-primary font-medium select-none flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-warning leading-none" aria-hidden="true">warning</span>
                  Skip permission prompts
                </span>
                <span className="text-[11px] text-text-secondary select-none">
                  Passes <code className="font-mono bg-surface-variant px-0.5 rounded">--dangerously-skip-permissions</code> to all stages. Use only in trusted environments.
                </span>
              </div>
            </label>
          )}
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
