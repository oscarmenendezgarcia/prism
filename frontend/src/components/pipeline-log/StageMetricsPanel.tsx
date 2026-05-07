/**
 * StageMetricsPanel — renders parsed metrics for a single pipeline stage.
 * T-007 (log-metrics-parser): fetches GET /runs/:runId/stages/:stageIndex/metrics,
 * polls every 5 s while the stage is running, stops when completed/failed/etc.
 *
 * Displays: duration, cost, turns, top-5 tools, error summary.
 * Loading / not-available / error states included.
 * Uses only Tailwind design-system tokens — no inline styles.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { getStageMetrics, MetricsNotAvailableError } from '@/api/client';
import type { StageMetrics, StageMetricsToolEntry } from '@/types';

/** Polling interval while a stage is actively running (ms). */
const METRICS_POLL_MS = 5_000;

/** Max tool rows to show in the top-tools table. */
const TOP_TOOLS_LIMIT = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1_000);
  return s > 0 ? `${m} m ${s} s` : `${m} m`;
}

function formatUsd(usd: number | null): string {
  if (usd == null) return '—';
  return `$${usd.toFixed(4)}`;
}

function shortPath(path: string): string {
  const parts = path.split('/');
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-border last:border-0">
      <span className="text-xs text-text-secondary shrink-0">{label}</span>
      <span className="text-xs text-text-primary font-medium text-right truncate max-w-[60%]">
        {value}
      </span>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2 mt-4 first:mt-0">
      <span className="material-symbols-outlined text-sm text-primary leading-none" aria-hidden="true">
        {icon}
      </span>
      <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">{title}</span>
    </div>
  );
}

function ToolsTable({ tools }: { tools: StageMetricsToolEntry[] }) {
  const top = tools.slice(0, TOP_TOOLS_LIMIT);
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-text-disabled uppercase tracking-wide">
          <th className="text-left font-medium pb-1 pr-2">Tool</th>
          <th className="text-right font-medium pb-1 pr-2">Calls</th>
          <th className="text-right font-medium pb-1">Errors</th>
        </tr>
      </thead>
      <tbody>
        {top.map((t) => (
          <tr key={t.name} className="border-t border-border">
            <td className="py-1 pr-2 text-text-primary font-mono truncate max-w-[140px]">{t.name}</td>
            <td className="py-1 pr-2 text-right text-text-secondary">{t.calls}</td>
            <td className={`py-1 text-right ${t.errors > 0 ? 'text-error font-semibold' : 'text-text-disabled'}`}>
              {t.errors > 0 ? t.errors : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex items-center gap-2 py-8 justify-center text-xs text-text-secondary">
      <span className="material-symbols-outlined text-sm animate-spin leading-none" aria-hidden="true">
        progress_activity
      </span>
      Loading metrics…
    </div>
  );
}

function NotAvailableState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span
        className="material-symbols-outlined text-3xl text-text-disabled leading-none"
        aria-hidden="true"
      >
        query_stats
      </span>
      <p className="text-sm text-text-secondary">Metrics not available yet.</p>
      <p className="text-xs text-text-disabled leading-relaxed max-w-[180px]">
        Metrics are produced once the stage starts writing to its log.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span
        className="material-symbols-outlined text-3xl text-error leading-none"
        aria-hidden="true"
      >
        error_outline
      </span>
      <p className="text-sm text-text-secondary">Failed to load metrics.</p>
      <p className="text-xs text-text-disabled leading-relaxed max-w-[200px] break-words">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function MetricsContent({ metrics }: { metrics: StageMetrics }) {
  const { duration, cost, turns, tools, errors, files, summary, parser } = metrics;

  return (
    <div className="flex flex-col gap-0 text-xs">
      {/* ── Duration & Turns ─────────────────────────────────────────────── */}
      <SectionHeader icon="timer" title="Performance" />
      <div className="bg-surface-elevated rounded-lg px-3 py-1">
        <MetricRow label="Wall time"  value={formatMs(duration.wallMs)} />
        <MetricRow label="API time"   value={formatMs(duration.apiMs)} />
        <MetricRow label="Turns"      value={turns ?? '—'} />
        <MetricRow label="Stop reason" value={metrics.stopReason ?? '—'} />
      </div>

      {/* ── Cost ─────────────────────────────────────────────────────────── */}
      <SectionHeader icon="payments" title="Cost" />
      <div className="bg-surface-elevated rounded-lg px-3 py-1">
        {cost == null ? (
          <MetricRow label="Total" value="—" />
        ) : (
          <>
            <MetricRow label="Total" value={formatUsd(cost.totalUsd)} />
            {cost.perModel.map((m) => (
              <MetricRow
                key={m.model}
                label={m.model}
                value={
                  <span>
                    <span className="text-text-secondary">{m.inputTokens.toLocaleString()} in</span>
                    {' / '}
                    <span className="text-text-secondary">{m.outputTokens.toLocaleString()} out</span>
                    {m.cacheReadInputTokens > 0 && (
                      <span className="text-success ml-1">({m.cacheReadInputTokens.toLocaleString()} cached)</span>
                    )}
                  </span>
                }
              />
            ))}
          </>
        )}
      </div>

      {/* ── Top tools ────────────────────────────────────────────────────── */}
      <SectionHeader icon="build" title={`Tools (${tools.totalCalls} calls)`} />
      <div className="bg-surface-elevated rounded-lg px-3 py-2">
        {tools.byName.length > 0 ? (
          <ToolsTable tools={tools.byName} />
        ) : (
          <p className="text-text-disabled py-1">No tool calls recorded.</p>
        )}
      </div>

      {/* ── Errors ───────────────────────────────────────────────────────── */}
      {(errors.toolErrors > 0 || errors.rateLimitEvents > 0 || errors.permissionDenials > 0) && (
        <>
          <SectionHeader icon="warning" title="Errors" />
          <div className="bg-surface-elevated rounded-lg px-3 py-1">
            {errors.toolErrors > 0 && (
              <MetricRow label="Tool errors" value={<span className="text-error">{errors.toolErrors}</span>} />
            )}
            {errors.rateLimitEvents > 0 && (
              <MetricRow label="Rate limits" value={<span className="text-warning">{errors.rateLimitEvents}</span>} />
            )}
            {errors.permissionDenials > 0 && (
              <MetricRow label="Permission denials" value={<span className="text-warning">{errors.permissionDenials}</span>} />
            )}
            {errors.samples.length > 0 && (
              <div className="mt-2 space-y-1">
                {errors.samples.map((s, i) => (
                  <div key={i} className="rounded bg-error/10 px-2 py-1.5">
                    <span className="font-medium text-error">{s.tool}: </span>
                    <span className="text-text-secondary">{s.message}</span>
                    {s.preview && (
                      <p className="mt-0.5 font-mono text-text-disabled truncate">{s.preview}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Files ────────────────────────────────────────────────────────── */}
      {files.modified.length > 0 && (
        <>
          <SectionHeader icon="edit_document" title={`Modified (${files.modified.length})`} />
          <div className="bg-surface-elevated rounded-lg px-3 py-2 space-y-0.5 max-h-[120px] overflow-y-auto">
            {files.modified.map((f) => (
              <p key={f} className="font-mono text-text-primary truncate" title={f}>
                {shortPath(f)}
              </p>
            ))}
          </div>
        </>
      )}

      {/* ── Summary ──────────────────────────────────────────────────────── */}
      {summary && (
        <>
          <SectionHeader icon="summarize" title="Summary" />
          <div className="bg-surface-elevated rounded-lg px-3 py-2">
            <p className="text-text-secondary leading-relaxed whitespace-pre-wrap line-clamp-6">{summary}</p>
          </div>
        </>
      )}

      {/* ── Parser meta ──────────────────────────────────────────────────── */}
      <div className="mt-4 pt-2 border-t border-border">
        <p className="text-text-disabled text-[10px]">
          {parser.lineCount.toLocaleString()} lines · parsed {new Date(parser.parsedAt).toLocaleTimeString()}
          {parser.warnings.length > 0 && ` · ${parser.warnings.length} warning(s)`}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StageMetricsPanel
// ---------------------------------------------------------------------------

export interface StageMetricsPanelProps {
  /** Backend run ID (effective for this stage — may be a per-stage run). */
  runId: string;
  /** Stage index in the backend run (0 for frontend-driven pipeline stages). */
  stageIndex: number;
  /**
   * Store key: the pipeline-level stage index used as the cache key.
   * Differs from stageIndex when each stage has its own 1-stage backend run.
   */
  storeKey: number;
  /** Whether this stage is actively running. Controls polling. */
  isRunning: boolean;
}

/**
 * Fetches and renders parsed metrics for a single pipeline stage.
 * Polls every 5 s while `isRunning` is true; stops on completion.
 */
export function StageMetricsPanel({ runId, stageIndex, storeKey, isRunning }: StageMetricsPanelProps) {
  const metrics             = usePipelineLogStore((s) => s.stageMetrics[storeKey]);
  const isLoading           = usePipelineLogStore((s) => s.stageMetricsLoading[storeKey] ?? false);
  const error               = usePipelineLogStore((s) => s.stageMetricsError[storeKey] ?? null);
  const setMetrics          = usePipelineLogStore((s) => s.setStageMetrics);
  const setLoading          = usePipelineLogStore((s) => s.setStageMetricsLoading);
  const setError            = usePipelineLogStore((s) => s.setStageMetricsError);

  // Track whether "not available" (425) was returned — suppresses the error state.
  const notAvailableRef = useRef(false);

  const fetchMetrics = useCallback(async () => {
    if (!runId) return;
    setLoading(storeKey, true);
    setError(storeKey, null);
    notAvailableRef.current = false;
    try {
      const data = await getStageMetrics(runId, stageIndex);
      setMetrics(storeKey, data);
    } catch (err) {
      if (err instanceof MetricsNotAvailableError) {
        notAvailableRef.current = true;
        setMetrics(storeKey, null);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(storeKey, msg);
        console.error('[StageMetricsPanel] ERROR fetching metrics:', err);
      }
    } finally {
      setLoading(storeKey, false);
    }
  }, [runId, stageIndex, storeKey, setMetrics, setLoading, setError]);

  // Fetch on mount and when runId/stageIndex changes.
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Poll every 5 s while the stage is running.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(fetchMetrics, METRICS_POLL_MS);
    return () => clearInterval(id);
  }, [isRunning, fetchMetrics]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (isLoading && metrics == null) {
    return (
      <div className="flex flex-1 flex-col min-h-0 overflow-y-auto p-3">
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col min-h-0 overflow-y-auto p-3">
        <ErrorState message={error} />
      </div>
    );
  }

  if (metrics == null) {
    return (
      <div className="flex flex-1 flex-col min-h-0 overflow-y-auto p-3">
        <NotAvailableState />
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Stage metrics"
      className="flex flex-1 flex-col min-h-0 overflow-y-auto p-3"
    >
      {isRunning && (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-text-secondary">
          <span className="material-symbols-outlined text-xs text-primary leading-none animate-spin" aria-hidden="true">
            progress_activity
          </span>
          Live — refreshing every 5 s
        </div>
      )}
      <MetricsContent metrics={metrics} />
    </div>
  );
}
