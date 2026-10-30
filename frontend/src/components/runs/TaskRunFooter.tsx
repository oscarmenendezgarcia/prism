/**
 * The part of a card that shows its agent: how to start it, how it is going, and
 * what came out of it.
 */

import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';
import { useCanEdit, useIsAdmin } from '@/stores/useAuthStore';
import { isAwaitingReview } from '@/utils/issues';
import { runProblem, useTaskRunStore } from '@/stores/useTaskRunStore';
import { agentOf } from '@/utils/agents';
import type { ModelCliTool, StatusCategory, Task } from '@/types';
import { HarnessIcon } from './HarnessIcon';
import { failureMessage, PullRequestAction, ResultLine, SaveErrorNote, StatusLine } from './TaskRunStatus';

interface TaskRunFooterProps {
  task: Task;
  /** The category of the task's status. */
  column: StatusCategory;
  spaceId: string;
}

export function TaskRunFooter({ task, column, spaceId }: TaskRunFooterProps) {
  const view            = useTaskRunStore((s) => s.views[task.id]);
  const busy            = useTaskRunStore((s) => s.busyTaskIds.has(task.id));
  const harnesses       = useTaskRunStore((s) => s.harnesses);
  const start           = useTaskRunStore((s) => s.start);
  const retry           = useTaskRunStore((s) => s.retry);
  const createPullRequest = useTaskRunStore((s) => s.createPullRequest);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const openSpaceModal  = useAppStore((s) => s.openSpaceModal);
  const space           = useAppStore((s) => s.spaces.find((sp) => sp.id === spaceId));

  const canEdit         = useCanEdit();
  const isAdmin         = useIsAdmin();

  const missingHarness = column === 'in-progress' && view?.failure?.reason === 'binary_missing';

  // A card back in To do starts over, whatever its last run did. So does one whose
  // harness is not installed, since retrying could only fail the same way, and one
  // moved back to In progress by hand. One waiting for review has its result to look at.
  // So does one given to another agent since: its last run is not that agent's to go on with.
  const reassigned = !!view && !!agentOf(task.assigned) && task.assigned !== view.cliTool && ['failed', 'stopped'].includes(view.status);
  const canStart = column === 'todo' || missingHarness || (column !== 'done' && reassigned)
    || (column === 'in-progress' && (!view || (view.status === 'done' && !isAwaitingReview(task, space))));
  if (!canEdit) return null;
  if (canStart) {
    // Only an issue assigned to an agent can run.
    const agent = agentOf(task.assigned);
    if (!agent) return null;
    if (space && !space.workingDirectory) {
      if (!isAdmin) return null;
      return (
        <div className="flex items-center mt-3 -ml-2 [@media(pointer:coarse)]:mt-0" data-testid="run-footer">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); openSpaceModal('rename', space); }}
          >
            Set a repository to run agents
          </Button>
        </div>
      );
    }
    const problem = runProblem(agent, space, harnesses);
    return (
      <div className="flex flex-wrap items-center gap-1 mt-2 -ml-2 [@media(pointer:coarse)]:mt-0 [@media(pointer:coarse)]:ml-0" data-testid="run-footer">
        {missingHarness && <p className="w-full ml-2 text-xs text-error leading-snug">This agent is not installed on this machine.</p>}
        {problem && !missingHarness && <p className="flex-1 min-w-0 ml-2 text-xs text-text-secondary leading-snug" data-testid="run-problem">{problem}</p>}
        <span className="flex-1" />
        <Button
          variant="primary"
          size="sm"
          disabled={busy || task.isBlocked || !!problem}
          title={task.isBlocked ? 'Blocked by unfinished dependencies' : (problem ?? undefined)}
          onClick={(e) => { e.stopPropagation(); start(spaceId, task.id).catch(() => {}); }}
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">play_arrow</span>
          Run
        </Button>
      </div>
    );
  }

  if (!view) return null;

  if (view.status === 'question') {
    const question = task.comments?.find((c) => c.type === 'question' && !c.resolved);
    return (
      <div className="flex flex-col gap-2 mt-3 w-full" data-testid="run-footer">
        {question && <p className="text-xs text-warning leading-snug line-clamp-3">{question.text}</p>}
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); openDetailPanel(task); }}>Answer</Button>
          <span className="flex-1" />
          <HarnessIcon cliTool={view.cliTool} />
        </div>
      </div>
    );
  }

  const canRetry = (view.status === 'failed' || view.status === 'stopped') && task.assigned === view.cliTool && !runProblem(view.cliTool as ModelCliTool, space, harnesses);
  const message = failureMessage(view);

  return (
    <div className="flex flex-col gap-2 mt-3 w-full" data-testid="run-footer">
      {view.status !== 'working' && view.status !== 'checking' && <ResultLine view={view} />}
      <SaveErrorNote view={view} />
      {message && <p className="text-xs text-error leading-snug line-clamp-2">{message}</p>}
      <div className="flex items-center gap-2">
        <HarnessIcon cliTool={view.cliTool} />
        <StatusLine view={view} />
        <span className="flex-1" />
        {view.status === 'done' && (
          <PullRequestAction view={view} busy={busy} onCreate={() => { createPullRequest(spaceId, task.id).catch(() => {}); }} />
        )}
        {canRetry && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); retry(spaceId, task.id).catch(() => {}); }}
          >
            <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">refresh</span>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
