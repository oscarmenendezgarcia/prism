/**
 * Pipeline confirm modal — shown when the user clicks "Run Pipeline" on a task card.
 * Allows removing, reordering, and adding checkpoints per stage before launching.
 *
 * T-2: Pipeline editable por card.
 * T-3: "Pause before this stage" checkbox per stage (manual checkpoints).
 * T-4: "Use orchestrator mode" toggle at the bottom — routes to executeOrchestratorRun.
 * T-9: "Preview Prompts" button — calls POST /api/v1/runs/preview-prompts and shows
 *       each stage's prompt in a collapsible section below the stage row.
 * pipeline-drag-reorder: Replace ↑/↓ arrow buttons with @dnd-kit drag-and-drop.
 *   Checkpoints are now keyed by stable row instance ID (Set<string>), translated
 *   to number[] at API call time via checkpointsToIndices().
 */

import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { useAppStore } from '@/stores/useAppStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { previewPipelinePrompts } from '@/api/client';
import { SortableStageList } from './SortableStageList';
import { generateRowKey, checkpointsToIndices } from './pipelineReorder';
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
  const modal                  = useAppStore((s) => s.pipelineConfirmModal);
  const closePipeline          = useAppStore((s) => s.closePipelineConfirm);
  const startPipeline          = useAppStore((s) => s.startPipeline);
  const executeOrchestratorRun = useAppStore((s) => s.executeOrchestratorRun);
  const spaces          = useAppStore((s) => s.spaces);
  const availableAgents = useAppStore((s) => s.availableAgents);
  const loadAgents      = useAppStore((s) => s.loadAgents);

  const [stages, setStages]         = useState<PipelineStage[]>([]);
  /**
   * Stable per-row instance keys, parallel to `stages`.
   * Generated once when the modal opens (and for each added stage).
   * Keying by instance — not by stage ID — means duplicate agent IDs in the
   * same pipeline each get their own distinct key (T-3 / ADR-1 §T-3).
   */
  const [stageKeys, setStageKeys]   = useState<string[]>([]);
  /**
   * Row-key-keyed checkpoint set.
   * Translated to number[] at handleRun() time via checkpointsToIndices().
   * Immune to reorder because keys follow the stage, not the position.
   */
  const [checkpoints, setCheckpoints] = useState<Set<string>>(new Set());
  /** T-4: When true, routes to executeOrchestratorRun instead of startPipeline. */
  const [useOrchestrator, setUseOrchestrator] = useState(false);
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);

  // True when the active terminal tab has an established PTY connection.
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
      const initialStages = [...modal.stages];
      const initialKeys   = initialStages.map(() => generateRowKey());
      setStages(initialStages);
      setStageKeys(initialKeys);
      // Convert the number[] checkpoints from the store to a Set<string> of row keys.
      setCheckpoints(
        new Set((modal.checkpoints ?? []).map((i) => initialKeys[i]).filter(Boolean)),
      );
      setUseOrchestrator(modal.useOrchestratorMode ?? false);
      setDangerouslySkipPermissions(false);
      setPreviewPrompts(null);
      setExpandedPromptIndex(null);
      const space = spaces.find((s) => s.id === modal.spaceId);
      loadAgents(space?.workingDirectory);
    }
  }, [isOpen, modal]);

  /** Clear preview prompt cache whenever stages change (reorder/remove/add). */
  function invalidatePreviewCache() {
    setPreviewPrompts(null);
    setExpandedPromptIndex(null);
  }

  /** Called by SortableStageList after a drag-drop reorder. */
  function handleReorder(
    nextStages: PipelineStage[],
    nextKeys: string[],
    nextCheckpoints: Set<string>,
  ) {
    setStages(nextStages);
    setStageKeys(nextKeys);
    setCheckpoints(nextCheckpoints);
    invalidatePreviewCache();
  }

  function remove(i: number) {
    const keyToRemove = stageKeys[i];
    setStages((prev) => prev.filter((_, j) => j !== i));
    setStageKeys((prev) => prev.filter((_, j) => j !== i));
    setCheckpoints((prev) => {
      const next = new Set(prev);
      next.delete(keyToRemove);
      return next;
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

  function toggleCheckpoint(key: string) {
    setCheckpoints((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleRun() {
    if (!modal || stages.length === 0) return;
    closePipeline();

    // Translate row-key checkpoints to the positional number[] the backend expects.
    const checkpointIndices = checkpointsToIndices(stageKeys, checkpoints);

    if (useOrchestrator) {
      await executeOrchestratorRun(modal.spaceId, modal.taskId, stages, dangerouslySkipPermissions);
    } else {
      await startPipeline(
        modal.spaceId,
        modal.taskId,
        stages,
        checkpointIndices,
        dangerouslySkipPermissions,
      );
    }
  }

  return (
    <Modal open={isOpen} onClose={closePipeline} labelId={TITLE_ID}>
      <ModalHeader onClose={closePipeline}>
        <ModalTitle id={TITLE_ID}>Run Pipeline</ModalTitle>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          Drag rows to reorder (or use keyboard: Space → arrows → Space). Remove stages you don't need, or pause before any stage.
        </p>

        {/* Staggered timeline — wireframe S-06 */}
        {stages.length === 0 ? (
          <p className="text-sm text-error text-center py-4">Add at least one stage to run.</p>
        ) : (
          <>
            {/* Horizontal timeline dots — 4 per row */}
            <div className="grid grid-cols-4 gap-y-4 py-2">
              {stages.map((stage, i) => {
                const colorClass   = STAGE_COLOR_CLASS[stage] ?? 'text-primary';
                const bgClass      = STAGE_BG_CLASS[stage]    ?? 'bg-primary/10';
                const displayName  = availableAgents.find((a) => a.id === stage)?.displayName ?? stage;
                const isLastInRow  = (i + 1) % 4 === 0;
                const isLast       = i === stages.length - 1;
                const showConnector = !isLast && !isLastInRow;
                return (
                  <div
                    key={stageKeys[i] ?? stage + i}
                    className="relative flex flex-col items-center gap-2"
                    style={{ '--stagger-delay': `${i * 40}ms`, animationDelay: 'var(--stagger-delay)' } as React.CSSProperties} // lint-ok: stagger requires dynamic per-index CSS custom property
                  >
                    {/* Connector line to the right, vertically centered on the circle */}
                    {showConnector && (
                      <div className="absolute top-[18px] left-[calc(50%+20px)] right-0 h-px bg-border" aria-hidden="true" />
                    )}
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
                );
              })}
            </div>

            {/* Drag-and-drop stage list (replaces the static <ol> with ↑/↓ buttons) */}
            <SortableStageList
              stages={stages}
              stageKeys={stageKeys}
              checkpoints={checkpoints}
              availableAgents={availableAgents}
              useOrchestrator={useOrchestrator}
              onReorder={handleReorder}
              onRemove={remove}
              onToggleCheckpoint={toggleCheckpoint}
            />
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
                setStageKeys((prev) => [...prev, generateRowKey()]);
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
