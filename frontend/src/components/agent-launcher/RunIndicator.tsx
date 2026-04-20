/**
 * RunIndicator — unified run status indicator shown in the Header.
 * ADR-1 (run-indicator): replaces AgentRunIndicator + PipelineProgressBar with
 * a single component that reads exclusively from pipelineState.
 *
 * Render bifurcation:
 *   pipelineState === null  → return null
 *   status === 'paused'     → PausedBanner (Continue + Abort + elapsed)
 *   stages.length === 1     → SingleAgentDot (dot + displayName + elapsed + Abort)
 *   stages.length > 1       → StepNodes (step nodes + elapsed + Abort + Dismiss)
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAppStore, usePipelineState, useAvailableAgents } from '@/stores/useAppStore';
import type { BlockedReason } from '@/types';

// ---------------------------------------------------------------------------
// Stage label maps — includes code-reviewer (ADR-1 §3.4)
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  'senior-architect': 'Architect',
  'ux-api-designer':  'UX',
  'developer-agent':  'Dev',
  'qa-engineer-e2e':  'QA',
  'code-reviewer':    'Rev',
};

const STAGE_DISPLAY: Record<string, string> = {
  'senior-architect': 'Senior Architect',
  'ux-api-designer':  'UX / API Designer',
  'developer-agent':  'Developer Agent',
  'qa-engineer-e2e':  'QA Engineer E2E',
  'code-reviewer':    'Code Reviewer',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format elapsed seconds as m:ss (e.g. "1:05"). Clamps to 0 to handle clock skew. */
function formatElapsed(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Sub-renders
// ---------------------------------------------------------------------------

interface PausedBannerProps {
  stageName: string;
  pausedIdx: number;
  elapsed: number;
  onContinue: () => void;
  onAbort: () => void;
  onDismiss: () => void;
}

function PausedBanner({ stageName, pausedIdx, elapsed, onContinue, onAbort, onDismiss }: PausedBannerProps) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 rounded-sm bg-warning-container border border-warning/40"
      role="status"
      aria-live="polite"
      aria-label={`Pipeline paused before stage ${pausedIdx + 1}: ${stageName}`}
      data-testid="run-indicator-paused"
    >
      <span
        className="material-symbols-outlined text-base text-warning leading-none flex-shrink-0"
        aria-hidden="true"
      >
        pause_circle
      </span>

      <span className="text-xs text-text-primary flex-1 truncate">
        Paused before <strong>{stageName}</strong>
      </span>

      <span className="text-xs text-text-secondary tabular-nums flex-shrink-0">
        {formatElapsed(elapsed)}
      </span>

      <button
        onClick={onContinue}
        aria-label="Continue pipeline"
        title="Continue"
        className="text-xs text-primary hover:text-primary/80 transition-colors duration-base flex items-center gap-1 flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          play_arrow
        </span>
        Continue
      </button>

      <button
        onClick={onAbort}
        aria-label="Abort pipeline"
        title="Abort pipeline"
        className="text-xs text-error hover:text-error-hover transition-colors duration-base flex items-center gap-1 flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          stop
        </span>
        Abort
      </button>

      <button
        onClick={onDismiss}
        aria-label="Dismiss pipeline indicator"
        title="Dismiss"
        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-base flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}

interface InterruptedBannerProps {
  elapsed: number;
  onResume: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}

function InterruptedBanner({ elapsed, onResume, onCancel, onDismiss }: InterruptedBannerProps) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 rounded-sm bg-warning-container border border-warning/40"
      role="status"
      aria-live="polite"
      aria-label="Pipeline interrupted"
      data-testid="run-indicator-interrupted"
    >
      <span
        className="material-symbols-outlined text-base text-warning leading-none flex-shrink-0"
        aria-hidden="true"
      >
        pause_circle
      </span>

      <span className="text-xs text-text-primary flex-1 truncate">
        Pipeline interrupted
      </span>

      <span className="text-xs text-text-secondary tabular-nums flex-shrink-0">
        {formatElapsed(elapsed)}
      </span>

      <button
        onClick={onResume}
        aria-label="Resume pipeline"
        title="Resume"
        className="text-xs text-primary hover:text-primary/80 transition-colors duration-base flex items-center gap-1 flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          play_arrow
        </span>
        Resume
      </button>

      <button
        onClick={onCancel}
        aria-label="Cancel pipeline"
        title="Cancel"
        className="text-xs text-error hover:text-error-hover transition-colors duration-base flex items-center gap-1 flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          stop
        </span>
        Cancel
      </button>

      <button
        onClick={onDismiss}
        aria-label="Dismiss pipeline indicator"
        title="Dismiss"
        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-base flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}

interface BlockedBannerProps {
  blockedReason: BlockedReason;
  elapsed: number;
  onOpenTask: () => void;
  onAbort: () => void;
  onDismiss: () => void;
}

/**
 * Shown when a backend pipeline run is in the `blocked` status —
 * it posted a question and is waiting for a human to resolve it before
 * the next stage can start.
 */
function BlockedBanner({ blockedReason, elapsed, onOpenTask, onAbort, onDismiss }: BlockedBannerProps) {
  // Truncate long question text for the inline chip.
  const preview = blockedReason.text.length > 60
    ? `${blockedReason.text.slice(0, 57)}…`
    : blockedReason.text;

  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 rounded-sm bg-warning-container border border-warning/40"
      role="status"
      aria-live="polite"
      aria-label={`Pipeline blocked: ${blockedReason.text}`}
      data-testid="run-indicator-blocked"
    >
      <span
        className="material-symbols-outlined text-base text-warning leading-none flex-shrink-0"
        aria-hidden="true"
      >
        pause_circle
      </span>

      <span className="text-xs text-text-primary flex-1 truncate" title={blockedReason.text}>
        Blocked — <em className="not-italic text-warning">{preview}</em>
      </span>

      <span className="text-xs text-text-secondary tabular-nums flex-shrink-0">
        {formatElapsed(elapsed)}
      </span>

      <button
        onClick={onOpenTask}
        aria-label="Resolve question"
        title="Resolve question"
        className="text-xs text-primary hover:text-primary/80 transition-colors duration-base flex items-center gap-1 flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          open_in_new
        </span>
        Resolve
      </button>

      <button
        onClick={onAbort}
        aria-label="Abort pipeline"
        title="Abort pipeline"
        className="text-xs text-error hover:text-error-hover transition-colors duration-base flex items-center gap-1 flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          stop
        </span>
        Abort
      </button>

      <button
        onClick={onDismiss}
        aria-label="Dismiss pipeline indicator"
        title="Dismiss"
        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-base flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}

interface SingleAgentDotProps {
  displayName: string;
  elapsed: number;
  onAbort: () => void;
}

function SingleAgentDot({ displayName, elapsed, onAbort }: SingleAgentDotProps) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-primary/[0.08] border border-primary/[0.18] shadow-[0_0_12px_rgba(124,109,250,0.15)]"
      role="status"
      aria-live="polite"
      aria-label={`Agent running: ${displayName}, elapsed ${formatElapsed(elapsed)}`}
      data-testid="run-indicator-single"
    >
      {/* Glow pulse ring */}
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary shadow-[0_0_6px_rgba(124,109,250,0.9)]" />
      </span>

      <span className="text-xs font-medium text-primary">
        {displayName}
      </span>

      <span className="text-xs text-text-secondary tabular-nums">
        {formatElapsed(elapsed)}
      </span>

      <button
        onClick={onAbort}
        aria-label="Abort pipeline"
        title="Abort pipeline"
        className="ml-1 w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-error hover:bg-error/[0.10] transition-colors duration-base"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}

interface StepNodesProps {
  stages: string[];
  currentStageIndex: number;
  status: string;
  elapsed: number;
  onAbort: () => void;
  onDismiss: () => void;
}

function StepNodes({ stages, currentStageIndex, status, elapsed, onAbort, onDismiss }: StepNodesProps) {
  // Track which indices were injected via loop so we can animate them in.
  const prevLengthRef = useRef(stages.length);
  const [injectedFrom, setInjectedFrom] = useState<number | null>(null);

  useEffect(() => {
    const prev = prevLengthRef.current;
    if (stages.length > prev) {
      setInjectedFrom(prev);
      const t = setTimeout(() => setInjectedFrom(null), 1500);
      prevLengthRef.current = stages.length;
      return () => clearTimeout(t);
    }
    prevLengthRef.current = stages.length;
  }, [stages.length]);

  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 rounded-sm bg-surface-variant border border-border"
      role="status"
      aria-live="polite"
      aria-label={`Pipeline: stage ${currentStageIndex + 1} of ${stages.length}`}
      data-testid="run-indicator-steps"
    >
      {/* Stage step nodes */}
      <div className="flex items-center gap-1">
        {stages.map((stage, idx) => {
          const isActive    = idx === currentStageIndex && status === 'running';
          const isCompleted = idx < currentStageIndex || status === 'completed';
          const isInjected  = injectedFrom !== null && idx >= injectedFrom;

          return (
            <React.Fragment key={`${stage}-${idx}`}>
              {/* Connector line */}
              {idx > 0 && (
                <div
                  className={`w-4 h-px ${isCompleted || idx <= currentStageIndex ? 'bg-primary' : isInjected ? 'bg-warning/50' : 'bg-border'}`}
                  aria-hidden="true"
                />
              )}

              {/* Step node */}
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-colors duration-300 ${
                  isInjected
                    ? 'animate-loop-pop bg-warning/20 text-warning border border-warning/50'
                    : isActive
                    ? 'bg-primary text-on-primary animate-run-pulse'
                    : isCompleted
                    ? 'bg-success/[0.15] text-success border border-success/30'
                    : 'bg-surface text-text-disabled border border-border'
                }`}
                title={isInjected ? `${stage} (loop injected)` : stage}
                aria-label={`${STAGE_LABELS[stage] ?? stage}: ${
                  isInjected ? 'loop injected' : isCompleted ? 'done' : isActive ? 'running' : 'pending'
                }`}
              >
                {isCompleted && !isInjected ? (
                  <span className="material-symbols-outlined text-xs leading-none" aria-hidden="true">
                    check
                  </span>
                ) : (
                  STAGE_LABELS[stage]?.[0] ?? (idx + 1).toString()
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Elapsed time */}
      <span className="text-xs text-text-secondary tabular-nums">
        {formatElapsed(elapsed)}
      </span>

      {/* Abort — only while actively running */}
      {status === 'running' && (
        <button
          onClick={onAbort}
          aria-label="Abort pipeline"
          title="Abort pipeline"
          className="text-xs text-error hover:text-error-hover hover:bg-error/[0.10] px-2 py-0.5 rounded transition-colors duration-base flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
            stop
          </span>
          Abort
        </button>
      )}

      {/* Dismiss — always visible so a stuck indicator can be cleared */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss pipeline indicator"
        title="Dismiss"
        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-base"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunIndicator — main export
// ---------------------------------------------------------------------------

export function RunIndicator() {
  const pipelineState  = usePipelineState();
  const agents         = useAvailableAgents();
  const abortPipeline         = useAppStore((s) => s.abortPipeline);
  const clearPipeline         = useAppStore((s) => s.clearPipeline);
  const resumePipeline        = useAppStore((s) => s.resumePipeline);
  const resumeInterruptedRun  = useAppStore((s) => s.resumeInterruptedRun);
  const openDetailPanel       = useAppStore((s) => s.openDetailPanel);
  const tasks                 = useAppStore((s) => s.tasks);

  const [elapsedSecs, setElapsedSecs] = useState(0);

  // Timer: ticks every 1 s while running; freezes at finishedAt for terminal states.
  useEffect(() => {
    if (!pipelineState) {
      setElapsedSecs(0);
      return;
    }
    const startMs    = new Date(pipelineState.startedAt).getTime();
    const isTerminal = pipelineState.status !== 'running'
      && pipelineState.status !== 'paused'
      && pipelineState.status !== 'blocked';
    if (isTerminal) {
      const endMs = pipelineState.finishedAt
        ? new Date(pipelineState.finishedAt).getTime()
        : Date.now();
      setElapsedSecs(Math.floor((endMs - startMs) / 1000));
      return;
    }
    setElapsedSecs(Math.floor((Date.now() - startMs) / 1000));
    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [pipelineState?.startedAt, pipelineState?.status, pipelineState?.finishedAt]);

  // Auto-dismiss on completion after a brief moment so the user sees the checkmarks.
  useEffect(() => {
    if (pipelineState?.status !== 'completed') return;
    const t = setTimeout(() => clearPipeline(), 2000);
    return () => clearTimeout(t);
  }, [pipelineState?.status, clearPipeline]);

  if (!pipelineState) return null;

  const { stages, currentStageIndex, status, pausedBeforeStage, blockedReason } = pipelineState;

  /** Find the task in the board so we can open the detail panel. */
  const findTaskById = (id: string) =>
    tasks['todo'].find((t) => t.id === id) ??
    tasks['in-progress'].find((t) => t.id === id) ??
    tasks['done'].find((t) => t.id === id);

  // --- Blocked mode ---
  if (status === 'blocked' && blockedReason) {
    const task = findTaskById(pipelineState.taskId);
    return (
      <BlockedBanner
        blockedReason={blockedReason}
        elapsed={elapsedSecs}
        onOpenTask={() => { if (task) openDetailPanel(task); }}
        onAbort={abortPipeline}
        onDismiss={clearPipeline}
      />
    );
  }

  // --- Interrupted mode ---
  if (status === 'interrupted') {
    return (
      <InterruptedBanner
        elapsed={elapsedSecs}
        onResume={resumeInterruptedRun}
        onCancel={abortPipeline}
        onDismiss={clearPipeline}
      />
    );
  }

  // --- Paused mode ---
  if (status === 'paused') {
    const pausedIdx = pausedBeforeStage ?? currentStageIndex;
    const stageName = STAGE_DISPLAY[stages[pausedIdx]] ?? stages[pausedIdx];
    return (
      <PausedBanner
        stageName={stageName}
        pausedIdx={pausedIdx}
        elapsed={elapsedSecs}
        onContinue={resumePipeline}
        onAbort={abortPipeline}
        onDismiss={clearPipeline}
      />
    );
  }

  // --- Single-agent mode (1 stage) ---
  if (stages.length === 1) {
    const agentId     = stages[0];
    const displayName = STAGE_DISPLAY[agentId]
      ?? agents.find((a) => a.id === agentId)?.displayName
      ?? agentId;
    return (
      <SingleAgentDot
        displayName={displayName}
        elapsed={elapsedSecs}
        onAbort={abortPipeline}
      />
    );
  }

  // --- Multi-stage mode (N stages) ---
  return (
    <StepNodes
      stages={stages}
      currentStageIndex={currentStageIndex}
      status={status}
      elapsed={elapsedSecs}
      onAbort={abortPipeline}
      onDismiss={clearPipeline}
    />
  );
}
