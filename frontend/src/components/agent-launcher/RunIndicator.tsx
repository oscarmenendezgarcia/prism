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

import React, { useEffect, useState } from 'react';
import { useAppStore, usePipelineState, useAvailableAgents } from '@/stores/useAppStore';

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

/** Format elapsed seconds as m:ss (e.g. "1:05"). */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
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
      className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-warning/10 border border-warning/40"
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
        className="text-xs text-primary hover:text-primary/80 transition-colors duration-150 flex items-center gap-1 flex-shrink-0"
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
        className="text-xs text-error hover:text-error-hover transition-colors duration-150 flex items-center gap-1 flex-shrink-0"
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
        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-150 flex-shrink-0"
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
      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/[0.10] border border-primary/[0.20]"
      role="status"
      aria-live="polite"
      aria-label={`Agent running: ${displayName}, elapsed ${formatElapsed(elapsed)}`}
      data-testid="run-indicator-single"
    >
      {/* Pulsing dot */}
      <span
        className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0"
        aria-hidden="true"
      />

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
        className="ml-1 w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-error hover:bg-error/[0.10] transition-colors duration-150"
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
  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-surface-variant border border-border"
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

          return (
            <React.Fragment key={stage}>
              {/* Connector line */}
              {idx > 0 && (
                <div
                  className={`w-4 h-px ${isCompleted || idx <= currentStageIndex ? 'bg-primary' : 'bg-border'}`}
                  aria-hidden="true"
                />
              )}

              {/* Step node */}
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-colors duration-200 ${
                  isActive
                    ? 'bg-primary text-on-primary animate-pulse'
                    : isCompleted
                    ? 'bg-success/[0.15] text-success border border-success/30'
                    : 'bg-surface text-text-disabled border border-border'
                }`}
                title={stage}
                aria-label={`${STAGE_LABELS[stage] ?? stage}: ${
                  isCompleted ? 'done' : isActive ? 'running' : 'pending'
                }`}
              >
                {isCompleted ? (
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
          className="text-xs text-error hover:text-error-hover transition-colors duration-150 flex items-center gap-1"
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
        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-150"
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
  const abortPipeline  = useAppStore((s) => s.abortPipeline);
  const clearPipeline  = useAppStore((s) => s.clearPipeline);
  const resumePipeline = useAppStore((s) => s.resumePipeline);

  const [elapsedSecs, setElapsedSecs] = useState(0);

  // Timer: resets when pipelineState.startedAt changes, ticks every 1 s.
  // ADR-1 §3.5: identical timer logic to PipelineProgressBar.
  useEffect(() => {
    if (!pipelineState) {
      setElapsedSecs(0);
      return;
    }
    const startMs = new Date(pipelineState.startedAt).getTime();
    setElapsedSecs(Math.floor((Date.now() - startMs) / 1000));

    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [pipelineState?.startedAt]);

  if (!pipelineState) return null;

  const { stages, currentStageIndex, status, pausedBeforeStage } = pipelineState;

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
