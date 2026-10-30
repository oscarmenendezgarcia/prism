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
      return <Line icon="dot" className="text-text-secondary">{`Checking: ${view.hook?.name ?? ''}`}</Line>;
    case 'question':
      return <Line icon="help" className="text-warning">Has a question</Line>;
    case 'approval':
      return <Line icon="front_hand" className="text-warning">Needs your approval</Line>;
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

const STEP_SEGMENT: Record<string, string> = {
  passed:            'bg-success',
  running:           'bg-primary animate-run-pulse',
  approved:          'bg-primary animate-run-pulse',
  awaiting_approval: 'bg-warning',
  failed:            'bg-error',
};

/** The hooks a run goes through, as a thin bar on the card. Nothing without hooks. */
export function StepBar({ view }: { view: TaskRunView }) {
  const steps = view.steps ?? [];
  if (steps.length === 0) return null;
  const agentDone = view.status !== 'working';
  return (
    <div className="flex gap-0.5" role="img" aria-label={`${steps.filter((s) => s.status === 'passed').length} of ${steps.length} checks passed`} data-testid="run-steps">
      <span className={`h-1 flex-1 rounded-full ${agentDone ? 'bg-success' : 'bg-primary animate-run-pulse'}`} />
      {steps.map((step) => (
        <span key={step.id} className={`h-1 flex-1 rounded-full ${STEP_SEGMENT[step.status] ?? 'bg-surface-variant'}`} />
      ))}
    </div>
  );
}

const STEP_ICON: Record<string, { icon: string; className: string; label: string }> = {
  passed:            { icon: 'check_circle', className: 'text-success', label: 'Passed' },
  failed:            { icon: 'cancel', className: 'text-error', label: 'Failed' },
  awaiting_approval: { icon: 'front_hand', className: 'text-warning', label: 'Waiting for you' },
  running:           { icon: 'progress_activity', className: 'text-primary', label: 'Running' },
  approved:          { icon: 'progress_activity', className: 'text-primary', label: 'Running' },
  interrupted:       { icon: 'stop_circle', className: 'text-text-secondary', label: 'Stopped' },
};

/** The hooks of a run, one per line, for the detail panel. */
export function StepList({ view }: { view: TaskRunView }) {
  const steps = view.steps ?? [];
  if (steps.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1" data-testid="run-step-list">
      {steps.map((step) => {
        const shown = STEP_ICON[step.status] ?? { icon: 'radio_button_unchecked', className: 'text-text-disabled', label: 'Waiting' };
        return (
          <li key={step.id} className="flex items-center gap-2 text-xs text-text-secondary">
            <span className={`material-symbols-outlined text-sm leading-none ${shown.className}`} aria-hidden="true">{shown.icon}</span>
            <span className="min-w-0 truncate text-text-primary">{step.name}</span>
            <span className="flex-shrink-0">{shown.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Why a run failed, in the user's terms. Null when it did not fail. */
export function failureMessage(view: TaskRunView): string | null {
  const { failure, hook } = view;
  if (!failure) return null;
  if (failure.kind === 'hook') {
    const retries = failure.retries ? ` The agent tried to fix it ${failure.retries === 1 ? 'once' : `${failure.retries} times`}.` : '';
    if (failure.timedOut) return `"${hook?.name}" took too long and was stopped.${retries}`;
    if (failure.verdict === 'fail') return `"${hook?.name}" found problems.${retries}`;
    if (failure.verdict === 'none') return `"${hook?.name}" finished without a clear verdict, so it does not count as approved.${retries}`;
    if (failure.exitCode === null) return `"${hook?.name}" could not run.${retries}`;
    return `"${hook?.name}" failed with exit code ${failure.exitCode}.${retries}`;
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
