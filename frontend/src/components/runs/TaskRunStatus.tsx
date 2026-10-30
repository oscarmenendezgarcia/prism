/**
 * Compact pieces that describe a run: its status line, its result line, and why it failed.
 */

import React from 'react';
import { Button } from '@/components/shared/Button';
import type { TaskRunView } from '@/types';

export function StatusLine({ view }: { view: TaskRunView }) {
  switch (view.status) {
    case 'working':
      return <Line icon="dot" className="text-text-secondary">Working</Line>;
    case 'checking':
      return <Line icon="dot" className="text-text-secondary">{view.hook?.name ? `Checking: ${view.hook.name}` : 'Saving'}</Line>;
    case 'question':
      return <Line icon="help" className="text-warning">Has a question</Line>;
    case 'failed':
      return <Line icon="error" className="text-error">{view.failure && view.hook?.name && view.failure.kind !== 'agent' && view.failure.kind !== 'save' ? `Failed: ${view.hook.name}` : 'Failed'}</Line>;
    case 'stopped':
      return <Line icon="stop_circle" className="text-text-secondary">Stopped</Line>;
    case 'done':
      return <Line icon="check_circle" className="text-success">Finished</Line>;
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

/** A link to the run's pull request, or the button that creates it or pushes what is new. */
export function PullRequestAction({ view, busy, onCreate }: { view: TaskRunView; busy: boolean; onCreate: () => void }) {
  const { result } = view;
  if (!result || result.fileCount === null || result.fileCount === 0 && !result.pr) return null;
  const pr = result.pr;
  const behind = !!pr && !!result.head && pr.pushedHead !== result.head;
  return (
    <span className="inline-flex items-center gap-2 flex-shrink-0" data-testid="run-pr">
      {pr && (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">call_merge</span>
          PR #{pr.number}
        </a>
      )}
      {(!pr || behind) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); onCreate(); }}
        >
          {pr ? 'Push changes' : 'Create PR'}
        </Button>
      )}
    </span>
  );
}

/** Why a run failed, in the user's terms. Null when it did not fail. */
export function failureMessage(view: TaskRunView): string | null {
  const { failure, hook } = view;
  if (!failure) return null;
  if (failure.kind === 'save') return 'The work could not be saved to the branch, so the task stays open.';
  if (failure.kind === 'pr') return `The pull request could not be opened.`;
  if (failure.kind === 'check') {
    if (failure.timedOut) return `"${hook?.name}" took too long and was stopped.`;
    if (failure.exitCode === null) return `"${hook?.name}" could not run.`;
    return `"${hook?.name}" failed with exit code ${failure.exitCode}.`;
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
