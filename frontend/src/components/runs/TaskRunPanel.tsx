/**
 * The agent section of the task detail: start or stop it, see what it changed file
 * by file, and read the output of its check and its log.
 */

import React, { useEffect, useState } from 'react';
import * as api from '@/api/client';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';
import { choiceProblem, useTaskRunStore } from '@/stores/useTaskRunStore';
import type { ChangedFile, StatusCategory, Task, TaskRunView } from '@/types';
import { isAwaitingReview } from '@/utils/issues';
import { AgentPicker } from './AgentPicker';
import { HarnessIcon, HARNESS_NAMES, type DirectCliTool } from './HarnessIcon';
import { failureMessage, PullRequestAction, ResultLine, SaveErrorNote, StatusLine } from './TaskRunStatus';

function PatchView({ patch }: { patch: string }) {
  return (
    <pre className="text-[11px] leading-[1.45] font-mono overflow-x-auto bg-surface py-2" data-testid="file-patch">
      {patch.split('\n').map((line, i) => {
        const isHeader = /^(diff |index |--- |\+\+\+ )/.test(line);
        let color = 'text-text-secondary';
        if (line.startsWith('@@')) color = 'text-info';
        else if (isHeader) color = 'text-text-disabled';
        else if (line.startsWith('+')) color = 'text-success bg-success/[0.08]';
        else if (line.startsWith('-')) color = 'text-error bg-error/[0.08]';
        return <span key={i} className={`block px-3 min-w-max ${color}`}>{line || ' '}</span>;
      })}
    </pre>
  );
}

function FileRow({ runId, file }: { runId: string; file: ChangedFile }) {
  const [open, setOpen]   = useState(false);
  const [patch, setPatch] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || patch !== null || file.binary) return;
    api.getRunFilePatch(runId, file.path)
      .then((d) => { setPatch(d.patch); setTruncated(d.truncated); })
      .catch(() => setError(true));
  }, [open, patch, runId, file]);

  return (
    <div className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-surface-variant/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <span className="material-symbols-outlined text-sm leading-none text-text-disabled" aria-hidden="true">{open ? 'expand_more' : 'chevron_right'}</span>
        <code className="flex-1 min-w-0 truncate font-mono text-text-primary" title={file.path}>{file.path}</code>
        {file.binary
          ? <span className="text-text-disabled flex-shrink-0">binary</span>
          : (
            <>
              <span className="text-success flex-shrink-0">+{file.additions}</span>
              <span className="text-error flex-shrink-0">−{file.deletions}</span>
            </>
          )}
      </button>
      {open && (
        <>
          {error && <p className="px-3 pb-2 text-xs text-error">The diff could not be loaded.</p>}
          {file.binary && <p className="px-3 pb-2 text-xs text-text-disabled">Binary file.</p>}
          {patch !== null && <PatchView patch={patch} />}
          {truncated && <p className="px-3 py-2 text-xs text-text-disabled">This diff is too long to show entirely.</p>}
        </>
      )}
    </div>
  );
}

function ChangedFiles({ view }: { view: TaskRunView }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [error, setError] = useState(false);
  // Only what changes the patches: other writes to the run must not collapse an open
  // diff. Rows are keyed on it too, so one does not keep showing an earlier patch.
  const { result } = view;
  const stamp = `${view.runId}:${view.iteration}:${view.status}:${result?.ref}:${result?.fileCount}:${result?.additions}:${result?.deletions}`;

  useEffect(() => {
    let current = true;
    setError(false);
    api.getRunFiles(view.runId)
      .then((d) => { if (current) setFiles(d.files); })
      .catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [stamp, view.runId]);

  if (error) return <p className="text-xs text-error">The list of files could not be loaded.</p>;
  if (!files || files.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden" data-testid="changed-files">
      {files.map((file) => <FileRow key={`${file.path}:${stamp}`} runId={view.runId} file={file} />)}
    </div>
  );
}

const LOG_POLL_MS = 3_000;

function RunLog({ runId, live }: { runId: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [log, setLog]   = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    const load = () => {
      api.getRunLog(runId)
        .then((text) => { if (current) setLog(text); })
        .catch(() => { if (current) setLog(null); });
    };
    load();
    const id = live ? setInterval(load, LOG_POLL_MS) : undefined;
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [open, runId, live]);

  return (
    <details className="text-xs text-text-secondary" onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="run-log">
      <summary className="cursor-pointer select-none hover:text-text-primary">View log</summary>
      {log === null
        ? <p className="mt-2 text-text-secondary">No log yet.</p>
        : <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-variant/40 p-3 font-mono text-[11px] whitespace-pre-wrap break-words">{log || 'The log is empty.'}</pre>}
    </details>
  );
}

interface TaskRunPanelProps {
  task: Task;
  /** The category of the task's status. */
  column: StatusCategory;
  spaceId: string;
}

export function TaskRunPanel({ task, column, spaceId }: TaskRunPanelProps) {
  const view   = useTaskRunStore((s) => s.views[task.id]);
  const busy   = useTaskRunStore((s) => s.busyTaskIds.has(task.id));
  const choice = useTaskRunStore((s) => s.choice);
  const harnesses = useTaskRunStore((s) => s.harnesses);
  const { start, stop, retry, close, createPullRequest } = useTaskRunStore.getState();
  const openSpaceModal = useAppStore((s) => s.openSpaceModal);
  const space = useAppStore((s) => s.spaces.find((sp) => sp.id === spaceId));

  const problem = choiceProblem(choice, harnesses);
  const startButton = (
    <div className="flex items-center gap-1">
      <AgentPicker />
      <Button
        variant="primary"
        size="sm"
        disabled={busy || task.isBlocked || !!problem}
        title={task.isBlocked ? 'Blocked by unfinished dependencies' : (problem ?? undefined)}
        onClick={() => { start(spaceId, task.id).catch(() => {}); }}
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">play_arrow</span>
        Run
      </Button>
    </div>
  );

  if (!view || column === 'todo' || (column === 'in-progress' && view.status === 'done' && !isAwaitingReview(task, space))) {
    if (column === 'done') return null;
    if (space && !space.workingDirectory) {
      return (
        <div className="flex flex-col gap-2" data-testid="run-panel">
          <div><Button variant="ghost" size="sm" onClick={() => openSpaceModal('rename', space)}>Set a repository to run agents</Button></div>
        </div>
      );
    }
    return <div className="flex flex-col gap-2" data-testid="run-panel">{startButton}</div>;
  }
  const missingHarness = column === 'in-progress' && view.failure?.reason === 'binary_missing';

  const live = view.status === 'working' || view.status === 'checking';
  const ended = view.status === 'failed' || view.status === 'stopped' || view.status === 'done';
  const message = failureMessage(view);
  const hookOutput = view.failure?.kind === 'check' || view.failure?.kind === 'pr' ? view.hook?.outputTail : null;

  return (
    <section className="flex flex-col gap-3" data-testid="run-panel" aria-label="Agent run">
      <div className="flex items-center gap-2 flex-wrap">
        <HarnessIcon cliTool={view.cliTool} />
        <span className="text-xs text-text-secondary">
          {HARNESS_NAMES[view.cliTool as DirectCliTool] ?? view.cliTool}
          {view.model ? ` · ${view.model}` : ''}
        </span>
        <StatusLine view={view} />
        <span className="flex-1" />
        {(live || view.status === 'question') && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => { stop(spaceId, task.id).catch(() => {}); }}>
            <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">stop</span>
            Stop
          </Button>
        )}
        {missingHarness && startButton}
        {(view.status === 'failed' || view.status === 'stopped') && !missingHarness && (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => { retry(spaceId, task.id).catch(() => {}); }}>
            <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">refresh</span>
            Retry
          </Button>
        )}
        {ended && !view.closedAt && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            title="Frees the disk space. The branch stays, and asking for changes brings it back."
            onClick={() => { close(spaceId, task.id).catch(() => {}); }}
          >
            Remove worktree
          </Button>
        )}
      </div>

      {message && <p className="text-xs text-error leading-snug" data-testid="run-failure">{message}</p>}
      <SaveErrorNote view={view} />
      {hookOutput && (
        <pre className="max-h-48 overflow-auto rounded-lg bg-error/[0.06] border border-error/20 p-3 font-mono text-[11px] text-text-secondary whitespace-pre-wrap break-words" data-testid="hook-output">{hookOutput}</pre>
      )}

      {ended && (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 min-w-0"><ResultLine view={view} /></div>
            <PullRequestAction view={view} busy={busy} onCreate={() => { createPullRequest(spaceId, task.id).catch(() => {}); }} />
          </div>
          <ChangedFiles view={view} />
        </>
      )}
      <RunLog runId={view.runId} live={live} />
    </section>
  );
}
