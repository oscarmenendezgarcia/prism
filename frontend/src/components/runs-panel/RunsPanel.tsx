/**
 * RunsPanel — unified panel replacing RunHistoryPanel + PipelineLogPanel.
 * T-004 (runs-panel-unification): single drawer showing ACTIVOS + HISTORIAL sections.
 *
 * Features:
 * - Resizable via usePanelResize (storageKey: prism:panel-width:runs)
 * - Two sections: ACTIVOS (running) and HISTORIAL (completed/failed/cancelled)
 * - Status filter pill bar reused from RunHistoryPanel
 * - Each run row has [↗] button to expand inline log viewer
 * - Only one row expanded at a time (expandedRunId local state)
 * - Calls openLogPanelForRun to hydrate PipelineState before showing RunLogViewer
 */

import React, { useState, useCallback } from 'react';
import { useRunHistoryStore, useFilteredRuns } from '@/stores/useRunHistoryStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { useAppStore } from '@/stores/useAppStore';
import { usePanelResize } from '@/hooks/usePanelResize';
import { RunLogViewer } from '@/components/pipeline-log/RunLogViewer';
import { groupRuns } from '@/components/agent-run-history/groupRuns';
import { computeAggregateStatus } from '@/components/agent-run-history/groupRuns';
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

/** Return the unique key identifying a RunGroup (pipelineRunId or run.id).
 *  Used for React list key and expandedRunId tracking. */
function getGroupKey(group: RunGroup): string {
  return group.type === 'pipeline' ? group.pipelineRunId : group.run.id;
}

/** Return the key used by pipelineStates / historicalPipelineStates for this group.
 *  Mirrors the key logic in openLogPanelForRun to avoid a mismatch for single-stage
 *  pipeline runs where run.id has a stage suffix (e.g. "abc-4") but the store uses
 *  run.pipelineRunId ("abc"). */
function getStoreKey(group: RunGroup): string {
  if (group.type === 'pipeline') return group.pipelineRunId;
  return group.run.pipelineRunId ?? group.run.id;
}

/** Return true when a RunGroup represents an active (running) run. */
function isActiveGroup(group: RunGroup): boolean {
  if (group.type === 'pipeline') return group.aggregateStatus === 'running';
  return group.run.status === 'running';
}

/** Build the openLogPanelForRun input for a RunGroup. */
function buildOpenInput(group: RunGroup): OpenLogPanelInput {
  if (group.type === 'pipeline') {
    return { kind: 'pipeline', pipelineRunId: group.pipelineRunId, stages: group.stages };
  }
  return { kind: 'single', run: group.run };
}

/** Format elapsed ms as a short duration string (m:ss). */
function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const minutes   = Math.floor(totalSecs / 60);
  const seconds   = totalSecs % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Human-readable relative time from ISO string. */
function relativeTime(iso: string): string {
  const secs = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}

// ---------------------------------------------------------------------------
// Status badge styles
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
// RunRow — a single expandable run entry
// ---------------------------------------------------------------------------

interface RunRowProps {
  /** Unique key for this row (run.id or pipelineRunId). */
  runKey: string;
  /** Task title — first stage's task for pipelines. */
  taskTitle: string;
  /** Agent display name — first stage for pipelines, agent for singles. */
  agentLabel: string;
  /** Aggregate status. */
  status: RunStatus;
  /** ISO timestamp of start. */
  startedAt: string;
  /** Duration in ms; null when not yet complete. */
  durationMs: number | null;
  /** Whether the log viewer is currently expanded for this row. */
  expanded: boolean;
  /** Toggle expansion callback. */
  onToggle: () => void;
  /** Whether this is a pipeline group (shows stage count badge). */
  stageCount?: number;
}

function RunRow({
  runKey: _runKey,
  taskTitle,
  agentLabel,
  status,
  startedAt,
  durationMs,
  expanded,
  onToggle,
  stageCount,
}: RunRowProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 transition-colors duration-150 border-l-2 ${
        expanded ? 'bg-surface-elevated border-l-primary' : 'bg-surface border-l-transparent hover:bg-surface-variant'
      }`}
    >
      {/* Status dot */}
      <span
        className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass[status] ?? 'bg-border'}`}
        aria-label={`Status: ${statusLabel[status] ?? status}`}
      />

      {/* Content */}
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
              <span className="text-[11px] text-text-secondary font-mono" aria-label={`Duration: ${formatDuration(durationMs)}`}>
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

      {/* Expand / collapse button */}
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        aria-label={`${expanded ? 'Collapse' : 'Open'} logs for ${taskTitle}`}
        aria-expanded={expanded}
        className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          expanded
            ? 'bg-primary/15 text-primary'
            : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
        }`}
      >
        <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
          {expanded ? 'expand_less' : 'open_in_new'}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface-variant/50 border-b border-border sticky top-0 z-[1]">
      <span className="text-primary text-xs leading-none" aria-hidden="true">◆</span>
      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        {label}
      </span>
      <span className="ml-auto text-[11px] text-text-disabled">
        {count}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunsPanel
// ---------------------------------------------------------------------------

/**
 * Unified Runs panel rendering ACTIVOS + HISTORIAL sections.
 * Replaces RunHistoryPanel + PipelineLogPanel.
 */
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

  // Local state: which run row has its log viewer expanded.
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  // Track pending expansion (waiting for openLogPanelForRun to hydrate state).
  const [pendingRunId, setPendingRunId]   = useState<string | null>(null);

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:runs',
    defaultWidth: 420,
    minWidth:     320,
    maxWidth:     700,
  });

  /** Look up the PipelineState for a given key from either store. */
  const getPipelineState = useCallback((key: string): PipelineState | null => {
    return pipelineStates[key] ?? historicalStates[key] ?? null;
  }, [pipelineStates, historicalStates]);

  /** Toggle the inline log viewer for a run. */
  const handleToggleExpand = useCallback(async (group: RunGroup) => {
    const key = getGroupKey(group);

    if (expandedRunId === key) {
      // Collapse.
      setExpandedRunId(null);
      return;
    }

    // Close any currently expanded row first.
    setExpandedRunId(null);

    // Mark as pending while hydrating.
    setPendingRunId(key);

    try {
      // Hydrate PipelineState and point the store at this run.
      await openLogPanelForRun(buildOpenInput(group));

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        component: 'runs-panel',
        event: 'runs_panel.expand',
        runId: key,
        mode: isActiveGroup(group) ? 'active' : 'historical',
      }));

      setExpandedRunId(key);
    } catch (err) {
      console.error('[RunsPanel] Failed to hydrate run for log viewer:', err);
    } finally {
      setPendingRunId(null);
    }
  }, [expandedRunId, openLogPanelForRun]);

  // ── Build run groups and split into ACTIVOS / HISTORIAL ───────────────────

  const groups   = groupRuns(filteredRuns);
  const activos  = groups.filter(isActiveGroup);
  const historial = groups.filter((g) => !isActiveGroup(g));

  // ── Render a single run row + optional inline log viewer ──────────────────

  const renderGroup = (group: RunGroup) => {
    const key       = getGroupKey(group);
    const expanded  = expandedRunId === key;
    const isPending = pendingRunId === key;

    // Derive display fields.
    let taskTitle:  string;
    let agentLabel: string;
    let status:     RunStatus;
    let startedAt:  string;
    let durationMs: number | null;
    let stageCount: number | undefined;

    if (group.type === 'pipeline') {
      const first  = group.stages[0];
      const total  = group.stages.every((s) => s.completedAt !== null)
        ? Math.max(...group.stages.map((s) => Date.parse(s.completedAt!))) -
          Math.min(...group.stages.map((s) => Date.parse(s.startedAt)))
        : null;
      taskTitle  = first.taskTitle;
      agentLabel = first.spaceName;
      status     = group.aggregateStatus;
      startedAt  = first.startedAt;
      durationMs = total;
      stageCount = group.stages.length;
    } else {
      const { run } = group;
      taskTitle  = run.taskTitle;
      agentLabel = run.agentDisplayName;
      status     = run.status;
      startedAt  = run.startedAt;
      durationMs = run.durationMs;
      stageCount = undefined;
    }

    // Look up PipelineState for this run (needed by RunLogViewer).
    // Use getStoreKey (not key) to match the key written by openLogPanelForRun —
    // for single-stage runs, run.id has a stage suffix but the store uses pipelineRunId.
    const storeKey    = getStoreKey(group);
    const ps          = getPipelineState(storeKey);
    const runId       = ps?.runId ?? null;
    const isRunActive = ps?.status === 'running';

    return (
      <li key={key} className="border-b border-border last:border-b-0">
        <RunRow
          runKey={key}
          taskTitle={taskTitle}
          agentLabel={agentLabel}
          status={status}
          startedAt={startedAt}
          durationMs={durationMs}
          expanded={expanded}
          onToggle={() => handleToggleExpand(group)}
          stageCount={stageCount}
        />

        {/* Inline log viewer — accordion expansion */}
        {(expanded || isPending) && (
          <div
            className="border-t border-border bg-surface-elevated"
            role="region"
            aria-label={`Logs for ${taskTitle}`}
          >
            {isPending && !expanded ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-text-secondary">
                <span
                  className="material-symbols-outlined text-sm animate-spin leading-none"
                  aria-hidden="true"
                >
                  progress_activity
                </span>
                Loading logs…
              </div>
            ) : (
              <RunLogViewer
                runId={runId}
                pipelineState={ps}
                isRunActive={isRunActive}
              />
            )}
          </div>
        )}
      </li>
    );
  };

  // ── Compute aggregate "has active run" for header dot ─────────────────────
  const hasActiveRun = filteredRuns.some((r: AgentRunRecord) => r.status === 'running');

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <aside
      role="region"
      aria-label="Runs panel with active and historical pipeline runs"
      className="relative flex flex-col bg-surface border-l border-border h-full shrink-0 w-[var(--panel-w)]"
      style={{ '--panel-w': `${width}px` } as React.CSSProperties} // lint-ok: CSS custom-property injection for dynamic panel resize
    >
      {/* Left-edge drag handle */}
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
            {/* ACTIVOS section */}
            {activos.length > 0 && (
              <section aria-label={`Active runs — ${activos.length}`}>
                <SectionHeader label="Activos" count={activos.length} />
                <ul role="list" aria-label="Active runs list">
                  {activos.map(renderGroup)}
                </ul>
              </section>
            )}

            {/* HISTORIAL section */}
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
    </aside>
  );
}
