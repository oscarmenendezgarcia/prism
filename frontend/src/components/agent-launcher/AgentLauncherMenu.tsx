/**
 * Agent launcher dropdown menu — rendered on TaskCard for the todo column.
 * ADR-1 (Agent Launcher) §3.1: lists available agents + "Run Full Pipeline" option.
 *
 * Lazy-loads agents on first open if the list is empty.
 * Disabled when activeRun is non-null (another agent is already running).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore, useActiveRun, useAvailableAgents } from '@/stores/useAppStore';
import type { AgentInfo } from '@/types';

interface AgentLauncherMenuProps {
  taskId: string;
  spaceId: string;
}

export function AgentLauncherMenu({ taskId, spaceId }: AgentLauncherMenuProps) {
  const [open, setOpen]         = useState(false);
  const [menuPos, setMenuPos]   = useState({ top: 0, left: 0 });
  const menuRef                 = useRef<HTMLDivElement>(null);
  const buttonRef               = useRef<HTMLButtonElement>(null);

  const activeRun           = useActiveRun();
  const availableAgents     = useAvailableAgents();
  const loadAgents          = useAppStore((s) => s.loadAgents);
  const prepareAgentRun     = useAppStore((s) => s.prepareAgentRun);
  const openPipelineConfirm = useAppStore((s) => s.openPipelineConfirm);
  const spaceData           = useAppStore((s) => s.spaces.find((sp) => sp.id === spaceId));
  const spacePipeline       = spaceData?.pipeline;
  const spaceWorkingDir     = spaceData?.workingDirectory;

  const pipelineStages = spacePipeline && spacePipeline.length > 0 ? spacePipeline : null;
  const pipelineLabel  = pipelineStages
    ? pipelineStages.map((s) => s.replace(/-/g, ' ')).join(' → ')
    : 'Full Pipeline';

  const isDisabled = activeRun !== null;

  const MENU_WIDTH    = 200;
  const MENU_MAX_HEIGHT = 300;

  /** Open dropdown — lazy-load agents on first open, scoped to this space's workingDirectory. */
  const handleOpen = useCallback(() => {
    if (isDisabled) return;
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Always open downward; clamp so the menu never leaves the viewport.
      const top  = Math.min(rect.bottom + 4, window.innerHeight - MENU_MAX_HEIGHT - 8);
      const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8);
      setMenuPos({ top, left });
    }
    setOpen(true);
    if (availableAgents.length === 0) {
      loadAgents(spaceWorkingDir ?? undefined);
    }
  }, [isDisabled, availableAgents.length, loadAgents, spaceWorkingDir]);

  /** Select a specific agent. */
  const handleSelectAgent = useCallback(
    (agent: AgentInfo) => {
      setOpen(false);
      prepareAgentRun(taskId, agent.id);
    },
    [prepareAgentRun, taskId]
  );

  /** Open pipeline confirm modal — user reviews/edits stages before running. */
  const handleRunPipeline = useCallback(() => {
    setOpen(false);
    openPipelineConfirm(spaceId, taskId);
  }, [openPipelineConfirm, spaceId, taskId]);

  /** Close dropdown on outside click. */
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  /** Close on Escape. */
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        disabled={isDisabled}
        aria-label="Run agent"
        aria-haspopup="true"
        aria-expanded={open}
        title={isDisabled ? 'Agent already running' : 'Run agent'}
        className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-primary/[0.10] hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
      >
        <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
          smart_toy
        </span>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Select agent"
          style={{ top: menuPos.top, left: menuPos.left, maxHeight: 300 }} // lint-ok: runtime-computed position from getBoundingClientRect — no static Tailwind equivalent
          className="fixed z-[9999] min-w-[200px] bg-surface-elevated border border-border rounded-lg shadow-modal overflow-y-auto"
        >
          {/* Agent list */}
          {availableAgents.length === 0 ? (
            <div className="px-3 py-3 text-xs text-text-secondary text-center">
              No agents found in ~/.claude/agents/
            </div>
          ) : (
            <ul className="py-1">
              {availableAgents.map((agent) => (
                <li key={agent.id}>
                  <button
                    role="menuitem"
                    onClick={() => handleSelectAgent(agent)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface-variant transition-colors duration-100 text-left"
                  >
                    <span
                      className="material-symbols-outlined text-base text-primary leading-none flex-shrink-0"
                      aria-hidden="true"
                    >
                      smart_toy
                    </span>
                    <span className="truncate">{agent.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Separator + pipeline option */}
          <div className="border-t border-border">
            <button
              role="menuitem"
              onClick={handleRunPipeline}
              className="w-full flex flex-col gap-0.5 px-3 py-2 text-sm text-text-primary hover:bg-surface-variant transition-colors duration-100 text-left"
            >
              <div className="flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-base text-warning leading-none flex-shrink-0"
                  aria-hidden="true"
                >
                  play_arrow
                </span>
                <span>Run Full Pipeline</span>
              </div>
              {pipelineStages && (
                <span className="text-[10px] text-text-disabled pl-6 leading-snug truncate max-w-[180px]">
                  {pipelineLabel}
                </span>
              )}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
