/**
 * Active agent run indicator — shown in the Header when activeRun is non-null.
 * ADR-1 (Agent Launcher) §3.1: pulsing dot + agent name + elapsed time + Cancel.
 *
 * Uses setInterval to update elapsed time every second.
 * Hidden completely (no reserved space) when activeRun is null.
 */

import React, { useEffect, useState } from 'react';
import { useAppStore, useActiveRun, useAvailableAgents } from '@/stores/useAppStore';

/**
 * Format elapsed seconds as m:ss (e.g. "1:05") or s (e.g. "0:42").
 */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AgentRunIndicator() {
  const activeRun      = useActiveRun();
  const agents         = useAvailableAgents();
  const cancelAgentRun = useAppStore((s) => s.cancelAgentRun);

  const [elapsedSecs, setElapsedSecs] = useState(0);

  // Reset elapsed time when a new run starts, then tick every second.
  useEffect(() => {
    if (!activeRun) {
      setElapsedSecs(0);
      return;
    }

    const startMs = new Date(activeRun.startedAt).getTime();
    setElapsedSecs(Math.floor((Date.now() - startMs) / 1000));

    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [activeRun]);

  if (!activeRun) return null;

  const agentDisplayName =
    agents.find((a) => a.id === activeRun.agentId)?.displayName ?? activeRun.agentId;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/[0.10] border border-primary/[0.20]"
      role="status"
      aria-live="polite"
      aria-label={`Agent running: ${agentDisplayName}, elapsed ${formatElapsed(elapsedSecs)}`}
    >
      {/* Pulsing dot */}
      <span
        className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0"
        aria-hidden="true"
      />

      {/* Agent name + elapsed */}
      <span className="text-xs font-medium text-primary">
        {agentDisplayName}
      </span>
      <span className="text-xs text-text-secondary tabular-nums">
        {formatElapsed(elapsedSecs)}
      </span>

      {/* Cancel button */}
      <button
        onClick={cancelAgentRun}
        aria-label="Cancel agent run"
        title="Cancel agent run"
        className="ml-1 w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-error hover:bg-error/[0.10] transition-colors duration-150"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}
