/**
 * RunsPanel — unified panel replacing RunHistoryPanel + PipelineLogPanel.
 * T-004 (runs-panel-unification): single drawer showing ACTIVOS + HISTORIAL sections.
 *
 * Navigation pattern: clicking a run navigates to a full-height detail view.
 * A back button returns to the run list. Replaces the previous accordion expansion.
 */

import React, { useState, useCallback } from 'react';
import { useRunHistoryStore, useFilteredRuns } from '@/stores/useRunHistoryStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { useAppStore } from '@/stores/useAppStore';
import { usePanelResize } from '@/hooks/usePanelResize';
import { RunLogViewer } from '@/components/pipeline-log/RunLogViewer';
import { groupRuns } from '@/components/agent-run-history/groupRuns';
import type { AgentRunRecord, PipelineState, RunStatus } from '@/types';
import type { RunGroup } from '@/components/agent-run-history/groupRuns';
import type { OpenLogPanelInput } from '@/stores/useAppStore';

// ---------------------------------------------------------------------------
// Filter pill bar
// ---------------------------------------------------------------------------

type FilterOption = { label: string; value: RunStatus | 'all' };

const FILTER_OPTIONS: FilterOption[] = [
  { label: 'All',       value: 'all'       },
  { label: 'Running',   value: 'running'   },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Failed',    value: 'failed'    },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGroupKey(group: RunGroup): string {
  return group.type === 'pipeline' ? group.pipelineRunId : group.run.id;
}

function getStoreKey(group: RunGroup): string {
  if (group.type === 'pipeline') return group.pipelineRunId;
  return group.run.pipelineRunId ?? group.run.id;
}

function isActiveGroup(group: RunGroup): boolean {
  if (group.type === 'pipeline') return group.aggregateStatus === 'running';
  return group.run.status === 'running';
}

function buildOpenInput(group: RunGroup): OpenLogPanelInput {
  if (group.type === 'pipeline') {
    return { kind: 'pipeline', pipelineRunId: group.pipelineRunId, stages: group.stages };
  }
  return { kind: 'single', run: group.run };
}

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const minutes   = Math.floor(totalSecs / 60);
  const seconds   = totalSecs % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function relativeTime(iso: string): string {
  const secs = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}

function deriveGroupDisplay(group: RunGroup) {
  if (group.type === 'pipeline') {
    const first    = group.stages[0];
    const allDone  = group.stages.every((s) => s.completedAt !== null);
    const total    = allDone
      ? Math.max(...group.stages.map((s) => Date.parse(s.completedAt!))) -
        Math.min(...group.stages.map((s) => Date.parse(s.startedAt)))
      : null;
    return {
      taskTitle:  first.taskTitle,
      agentLabel: first.spaceName,
      status:     group.aggregateStatus as RunStatus,
      startedAt:  first.startedAt,
      durationMs: total,
      stageCount: group.stages.length,
    };
  }
  const { run } = group;
  return {
    taskTitle:  run.taskTitle,
    agentLabel: run.agentDisplayName,
    status:     run.status,
    startedAt:  run.startedAt,
    durationMs: run.durationMs,
    stageCount: undefined as number | undefined,
  };
}

// ---------------------------------------------------------------------------
// Status dot styles
// ---------------------------------------------------------------------------

const statusDotClass: Record<string, string> = {
  running:   'bg-primary animate-pulse',
  completed: 'bg-success',
  failed:    'bg-error',
  cancelled: 'bg-warning',
};

const statusLabel: Record<string, string> = {
  running:   'Running',
  completed: 'Completed',
  failed:    'Failed',
  cancelled: 'Cancelled',
};

// ---------------------------------------------------------------------------
// RunRow — list item; navigates to detail on click
// ---------------------------------------------------------------------------

interface RunRowProps {
  taskTitle:  string;
  agentLabel: string;
  status:     RunStatus;
  startedAt:  string;
  durationMs: number | null;
  stageCount?: number;
  isPending:  boolean;
  onSelect:   () => void;
}

function RunRow({
  taskTitle,
  agentLabel,
  status,
  startedAt,
  durationMs,
  stageCount,
  isPending,
  onSelect,
}: RunRowProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-label={`Open logs for ${taskTitle}`}
      className="flex items-start gap-3 px-4 py-3 bg-surface transition-colors duration-150 border-l-2 border-l-transparent hover:bg-surface-variant hover:border-l-primary cursor-pointer"
    >
      <span
        className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass[status] ?? 'bg-border'}`}
        aria-label={`Status: ${statusLabel[status] ?? status}`}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate leading-snug">
          {taskTitle}
        </p>
        <p className="text-xs text-text-secondary truncate mt-0.5">{agentLabel}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[11px] text-text-disabled">{relativeTime(startedAt)}</span>
          {durationMs != null && (
            <>
              <span className="text-[11px] text-text-disabled" aria-hidden="true">·</span>
              <span className="text-[11px] text-text-secondary font-mono">
                {formatDuration(durationMs)}
              </span>
            </>
          )}
          {stageCount != null && stageCount > 1 && (
            <>
              <span className="text-[11px] text-text-disabled" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-variant text-text-secondary">
                <span className="material-symbols-outlined text-[10px] leading-none" aria-hidden="true">linear_scale</span>
                {stageCount} stages
              </span>
            </>
          )}
        </div>
      </div>

      <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-text-disabled" aria-hidden="true">
        {isPending ? (
          <span className="material-symbols-outlined text-[16px] leading-none animate-spin [animation-duration:0.65s]">
            progress_activity
          </span>
        ) : (
          <span className="material-symbols-outlined text-[16px] leading-none">
            chevron_right
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border sticky top-0 z-[1]">
      <span className="text-primary text-xs leading-none" aria-hidden="true">◆</span>
      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        {label}
      </span>
      <span className="ml-auto text-[11px] text-text-disabled">{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunsPanel
// ---------------------------------------------------------------------------

export function RunsPanel() {
  const filter            = useRunHistoryStore((s) => s.filter);
  const setFilter         = useRunHistoryStore((s) => s.setFilter);
  const loading           = useRunHistoryStore((s) => s.loading);
  const taskIdFilter      = useRunHistoryStore((s) => s.taskIdFilter);
  const clearTaskIdFilter = useRunHistoryStore((s) => s.clearTaskIdFilter);
  const filteredRuns      = useFilteredRuns();

  const setRunsPanelOpen   = usePipelineLogStore((s) => s.setRunsPanelOpen);
  const openLogPanelForRun = useAppStore((s) => s.openLogPanelForRun);
  const pipelineStates     = useAppStore((s) => s.pipelineStates);
  const historicalStates   = useAppStore((s) => s.historicalPipelineStates);

  // Navigation state: null = list view, non-null = detail view.
  const [selectedGroup, setSelectedGroup] = useState<RunGroup | null>(null);
  const [pendingKey,    setPendingKey]    = useState<string | null>(null);
  // Incremented on each back-press to trigger the back-slide animation.
  const [listKey, setListKey] = useState(0);

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:runs',
    defaultWidth: 420,
    minWidth:     320,
    maxWidth:     700,
  });

  const getPipelineState = useCallback((key: string): PipelineState | null => {
    return pipelineStates[key] ?? historicalStates[key] ?? null;
  }, [pipelineStates, historicalStates]);

  const handleSelectRun = useCallback(async (group: RunGroup) => {
    const key = getGroupKey(group);
    setPendingKey(key);
    try {
      await openLogPanelForRun(buildOpenInput(group));
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        component: 'runs-panel',
        event: 'runs_panel.navigate_detail',
        runId: key,
        mode: isActiveGroup(group) ? 'active' : 'historical',
      }));
      setSelectedGroup(group);
    } catch (err) {
      console.error('[RunsPanel] Failed to hydrate run:', err);
    } finally {
      setPendingKey(null);
    }
  }, [openLogPanelForRun]);

  const handleBack = useCallback(() => {
    setSelectedGroup(null);
    setListKey((k) => k + 1);
  }, []);

  const groups    = groupRuns(filteredRuns);
  const activos   = groups.filter(isActiveGroup);
  const historial = groups.filter((g) => !isActiveGroup(g));
  const hasActiveRun = filteredRuns.some((r: AgentRunRecord) => r.status === 'running');

  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize runs panel"
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      onMouseDown={handleMouseDown}
      className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors duration-150 z-10"
    />
  );

  // ── Detail view ────────────────────────────────────────────────────────────

  if (selectedGroup !== null) {
    const storeKey    = getStoreKey(selectedGroup);
    const ps          = getPipelineState(storeKey);
    const runId       = ps?.runId ?? null;
    const isRunActive = ps?.status === 'running';
    const { taskTitle, agentLabel, status, startedAt, durationMs, stageCount } =
      deriveGroupDisplay(selectedGroup);

    const meta = [
      agentLabel,
      relativeTime(startedAt),
      durationMs != null ? formatDuration(durationMs) : null,
      stageCount != null && stageCount > 1 ? `${stageCount} stages` : null,
    ].filter(Boolean).join(' · ');

    return (
      <aside
        role="region"
        aria-label={`Run detail: ${taskTitle}`}
        className="relative flex flex-col bg-surface border-l border-border h-full shrink-0 overflow-hidden w-[var(--panel-w)]"
        style={{ '--panel-w': `${width}px` } as React.CSSProperties} // lint-ok: CSS custom-property injection for dynamic panel resize
      >
        {resizeHandle}

        <div className="flex flex-col flex-1 min-h-0 [animation:var(--animate-detail-in)]">
          {/* Detail header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0 bg-surface-elevated">
            <button
              onClick={handleBack}
              aria-label="Back to runs list"
              className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant hover:text-text-primary transition-[colors,transform] duration-150 active:scale-[0.93] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
            >
              <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
                arrow_back
              </span>
            </button>

            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass[status] ?? 'bg-border'}`}
              aria-label={`Status: ${statusLabel[status] ?? status}`}
            />

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate leading-snug">
                {taskTitle}
              </p>
              <p className="text-[11px] text-text-disabled truncate">{meta}</p>
            </div>

            <button
              onClick={() => setRunsPanelOpen(false)}
              aria-label="Close runs panel"
              className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant hover:text-text-primary transition-[colors,transform] duration-150 active:scale-[0.93] shrink-0"
            >
              <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
                close
              </span>
            </button>
          </div>

          <RunLogViewer
            runId={runId}
            pipelineState={ps}
            isRunActive={isRunActive}
            fullHeight
          />
        </div>
      </aside>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────

  const renderGroup = (group: RunGroup) => {
    const key       = getGroupKey(group);
    const isPending = pendingKey === key;
    const { taskTitle, agentLabel, status, startedAt, durationMs, stageCount } =
      deriveGroupDisplay(group);

    return (
      <li key={key} className="border-b border-border last:border-b-0">
        <RunRow
          taskTitle={taskTitle}
          agentLabel={agentLabel}
          status={status}
          startedAt={startedAt}
          durationMs={durationMs}
          stageCount={stageCount}
          isPending={isPending}
          onSelect={() => handleSelectRun(group)}
        />
      </li>
    );
  };

  return (
    <aside
      role="region"
      aria-label="Runs panel with active and historical pipeline runs"
      className="relative flex flex-col bg-surface border-l border-border h-full shrink-0 overflow-hidden w-[var(--panel-w)] [animation:var(--animate-panel-in)]"
      style={{ '--panel-w': `${width}px` } as React.CSSProperties} // lint-ok: CSS custom-property injection for dynamic panel resize
    >
      {resizeHandle}

      <div
        key={listKey}
        className={`flex flex-col flex-1 min-h-0 ${listKey > 0 ? '[animation:var(--animate-panel-back)]' : ''}`}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-surface-elevated">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-primary leading-none" aria-hidden="true">
              account_tree
            </span>
            <span className="text-sm font-semibold text-text-primary">Runs</span>
            {hasActiveRun && (
              <span
                className="relative flex h-2 w-2"
                aria-label="Run active"
                title="A pipeline run is currently active"
              >
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
            )}
          </div>
          <button
            onClick={() => setRunsPanelOpen(false)}
            aria-label="Close runs panel"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface-variant hover:text-text-primary transition-colors duration-fast"
          >
            <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {/* Task ID filter chip */}
        {taskIdFilter && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0 bg-info-container">
            <span className="material-symbols-outlined text-sm text-info leading-none" aria-hidden="true">
              filter_alt
            </span>
            <span className="text-xs text-info flex-1 truncate">Filtering by task</span>
            <button
              onClick={clearTaskIdFilter}
              aria-label="Clear task filter"
              className="w-5 h-5 flex items-center justify-center rounded text-info hover:bg-info/[0.20] transition-colors duration-150"
            >
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">close</span>
            </button>
          </div>
        )}

        {/* Filter pill bar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0 overflow-x-auto">
          {FILTER_OPTIONS.map((opt) => {
            const isActive = filter === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                aria-pressed={isActive}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors duration-150 whitespace-nowrap ${
                  isActive
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-surface text-text-secondary border-border hover:bg-surface-variant'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Run list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && filteredRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <span className="material-symbols-outlined text-3xl text-text-disabled animate-pulse" aria-hidden="true">
                history
              </span>
              <p className="text-sm text-text-secondary">Loading runs…</p>
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <span className="material-symbols-outlined text-4xl text-text-disabled" aria-hidden="true">
                account_tree
              </span>
              <p className="text-sm font-medium text-text-secondary">
                {taskIdFilter ? 'No runs for this task' : filter === 'all' ? 'No runs yet' : `No ${filter} runs`}
              </p>
              <p className="text-xs text-text-disabled leading-relaxed max-w-[200px]">
                {taskIdFilter
                  ? 'No agents have been launched on this task yet.'
                  : filter === 'all'
                  ? 'Agent runs will appear here when you launch an agent from a task card.'
                  : `Switch to "All" to see runs with other statuses.`}
              </p>
            </div>
          ) : (
            <>
              {activos.length > 0 && (
                <section aria-label={`Active runs — ${activos.length}`}>
                  <SectionHeader label="Activos" count={activos.length} />
                  <ul role="list" aria-label="Active runs list">
                    {activos.map(renderGroup)}
                  </ul>
                </section>
              )}
              {historial.length > 0 && (
                <section aria-label={`Historical runs — ${historial.length}`}>
                  <SectionHeader label="Historial" count={historial.length} />
                  <ul role="list" aria-label="Historical runs list">
                    {historial.map(renderGroup)}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
