/**
 * Compact pieces that describe a run: its status line, its result line, and why it failed.
 */

import React from 'react';
import type { TaskRunView } from '@/types';

export function StatusLine({ view }: { view: TaskRunView }) {
  switch (view.status) {
    case 'working':
      return <Line icon="dot" className="text-text-secondary">Working</Line>;
    case 'checking':
      return <Line icon="dot" className="text-text-secondary">{`Checking: ${view.hook?.name ?? ''}`}</Line>;
    case 'question':
      return <Line icon="help" className="text-warning">Has a question</Line>;
    case 'failed':
      return <Line icon="error" className="text-error">{view.failure?.kind === 'hook' ? `Failed: ${view.hook?.name ?? 'check'}` : 'Failed'}</Line>;
    case 'stopped':
      return <Line icon="stop_circle" className="text-text-secondary">Stopped</Line>;
    case 'done':
      return <Line icon="check_circle" className="text-success">Done</Line>;
    default:
      return null;
  }
}

function Line({ icon, className, children }: { icon: string; className: string; children: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium min-w-0 ${className}`} data-testid="run-status">
      {icon === 'dot'
        ? <span className="w-1.5 h-1.5 rounded-full bg-primary animate-run-pulse flex-shrink-0" aria-hidden="true" />
        : <span className="material-symbols-outlined text-sm leading-none flex-shrink-0" aria-hidden="true">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function ResultLine({ view }: { view: TaskRunView }) {
  const { result } = view;
  if (!result || result.fileCount === null) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary min-w-0" data-testid="run-result">
      <span className="material-symbols-outlined text-sm leading-none flex-shrink-0" aria-hidden="true">difference</span>
      <span className="flex-shrink-0">{result.fileCount} {result.fileCount === 1 ? 'file' : 'files'}</span>
      <span className="text-success flex-shrink-0">+{result.additions}</span>
      <span className="text-error flex-shrink-0">−{result.deletions}</span>
      <span className="flex-1 min-w-0 truncate text-right font-mono text-[11px] text-text-secondary" title={result.branch}>{result.branch}</span>
    </div>
  );
}

/** Why a run failed, in the user's terms. Null when it did not fail. */
export function failureMessage(view: TaskRunView): string | null {
  const { failure, hook } = view;
  if (!failure) return null;
  if (failure.kind === 'hook') {
    return failure.timedOut
      ? `"${hook?.name}" took too long and was stopped.`
      : `"${hook?.name}" failed with exit code ${failure.exitCode ?? 'unknown'}.`;
  }
  if (failure.reason === 'binary_missing') return 'This agent is not installed on this machine.';
  if (failure.reason === 'worktree_unavailable') return 'The task\'s worktree could not be restored.';
  if (failure.reason) return `The agent stopped: ${failure.reason.replaceAll('_', ' ')}.`;
  return `The agent exited with code ${failure.exitCode ?? 'unknown'}.`;
}

export function SaveErrorNote({ view }: { view: TaskRunView }) {
  if (!view.result?.saveError) return null;
  return (
    <p className="text-xs text-error leading-snug" role="alert" data-testid="save-error">
      Some work could not be saved to the branch. It stays in the worktree.
    </p>
  );
}
