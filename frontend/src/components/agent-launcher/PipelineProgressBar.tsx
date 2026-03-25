/**
 * Pipeline progress bar — shown in the Header when a pipeline run is active.
 * ADR-1 (Agent Launcher) §3.1: horizontal step indicator with elapsed time + Abort.
 *
 * Hidden completely when pipelineState is null.
 */

import React, { useEffect, useState } from 'react';
import { useAppStore, usePipelineState } from '@/stores/useAppStore';

const STAGE_LABELS: Record<string, string> = {
  'senior-architect': 'Architect',
  'ux-api-designer':  'UX',
  'developer-agent':  'Dev',
  'qa-engineer-e2e':  'QA',
};

const STAGE_DISPLAY: Record<string, string> = {
  'senior-architect': 'Senior Architect',
  'ux-api-designer':  'UX / API Designer',
  'developer-agent':  'Developer Agent',
  'qa-engineer-e2e':  'QA Engineer E2E',
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PipelineProgressBar() {
  const pipelineState  = usePipelineState();
  const abortPipeline  = useAppStore((s) => s.abortPipeline);
  const clearPipeline  = useAppStore((s) => s.clearPipeline);
  const resumePipeline = useAppStore((s) => s.resumePipeline);

  const [elapsedSecs, setElapsedSecs] = useState(0);

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
  }, [pipelineState]);

  if (!pipelineState) return null;

  const { stages, currentStageIndex, status, pausedBeforeStage } = pipelineState;

  // T-3: render a distinct paused banner when the pipeline is waiting for
  // human confirmation before executing the next stage.
  if (status === 'paused') {
    const pausedIdx   = pausedBeforeStage ?? currentStageIndex;
    const stageName   = STAGE_DISPLAY[stages[pausedIdx]] ?? stages[pausedIdx];

    return (
      <div
        className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-warning/10 border border-warning/40"
        role="status"
        aria-label={`Pipeline paused before stage ${pausedIdx + 1}: ${stageName}`}
        data-testid="pipeline-paused-banner"
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
          {formatElapsed(elapsedSecs)}
        </span>

        {/* Continue — resumes from checkpoint */}
        <button
          onClick={resumePipeline}
          aria-label="Continue pipeline"
          title="Continue"
          className="text-xs text-primary hover:text-primary/80 transition-colors duration-150 flex items-center gap-1 flex-shrink-0"
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
            play_arrow
          </span>
          Continue
        </button>

        {/* Abort */}
        <button
          onClick={abortPipeline}
          aria-label="Abort pipeline"
          title="Abort pipeline"
          className="text-xs text-error hover:text-error-hover transition-colors duration-150 flex items-center gap-1 flex-shrink-0"
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
            stop
          </span>
          Abort
        </button>

        {/* Dismiss */}
        <button
          onClick={clearPipeline}
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

  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-surface-variant border border-border"
      role="status"
      aria-label={`Pipeline: stage ${currentStageIndex + 1} of ${stages.length}`}
    >
      {/* Stage steps */}
      <div className="flex items-center gap-1">
        {stages.map((stage, idx) => {
          const isActive    = idx === currentStageIndex && status === 'running';
          const isCompleted = idx < currentStageIndex || status === 'completed';
          const isPending   = idx > currentStageIndex;

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
                    : isPending
                    ? 'bg-surface text-text-disabled border border-border'
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
        {formatElapsed(elapsedSecs)}
      </span>

      {/* Abort button — only while actively running */}
      {status === 'running' && (
        <button
          onClick={abortPipeline}
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
        onClick={clearPipeline}
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
