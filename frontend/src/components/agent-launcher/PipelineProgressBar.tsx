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

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PipelineProgressBar() {
  const pipelineState = usePipelineState();
  const abortPipeline = useAppStore((s) => s.abortPipeline);

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

  const { stages, currentStageIndex, status } = pipelineState;

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

      {/* Abort button */}
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
    </div>
  );
}
