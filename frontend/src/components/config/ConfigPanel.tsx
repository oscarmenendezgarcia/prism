/**
 * Config editor panel — slide-over with view switch:
 *   "Agents & Routing" (default, Proposal D) | "Files" (existing editor)
 *
 * ADR-1 §5.1: width is dynamic via usePanelResize (was fixed w-[480px]).
 *
 * Responsibilities:
 *   - View switch between AgentRoutingView and Files (ConfigFileSidebar + ConfigEditor).
 *   - Route close-button through the dirty guard.
 *   - Route view-switch through the dirty guard when either routing OR file is dirty.
 *   - Show DiscardChangesDialog when pending navigation is blocked by dirty state.
 *   - Load file list on mount (useEffect → loadConfigFiles).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore }           from '@/stores/useAppStore';
import { ConfigFileSidebar }     from '@/components/config/ConfigFileSidebar';
import { ConfigEditor }          from '@/components/config/ConfigEditor';
import { AgentRoutingView }      from '@/components/config/AgentRoutingView';
import { PreferencesView }       from '@/components/config/PreferencesView';
import { ConfigViewTabs }        from '@/components/config/ConfigViewTabs';
import type { ConfigView }       from '@/components/config/ConfigViewTabs';
import { DiscardChangesDialog }  from '@/components/config/DiscardChangesDialog';
import { Modal, ModalHeader, ModalTitle } from '@/components/shared/Modal';
import { usePanelResize }        from '@/hooks/usePanelResize';

/** Shape of a pending navigation blocked by the dirty guard. */
type PendingNav =
  | { type: 'close' }
  | { type: 'file'; fileId: string }
  | { type: 'view'; view: ConfigView }
  | { type: 'prompt'; fileId: string };

export function ConfigPanel() {
  const setConfigPanelOpen = useAppStore((s) => s.setConfigPanelOpen);
  const loadConfigFiles    = useAppStore((s) => s.loadConfigFiles);
  const activeSpaceId      = useAppStore((s) => s.activeSpaceId);
  const selectConfigFile   = useAppStore((s) => s.selectConfigFile);
  const configDirty        = useAppStore((s) => s.configDirty);
  const configFiles        = useAppStore((s) => s.configFiles);
  const activeConfigFileId = useAppStore((s) => s.activeConfigFileId);
  const showToast          = useAppStore((s) => s.showToast);

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:config',
    defaultWidth: 480,
    minWidth:     320,
    maxWidth:     800,
  });

  const [view, setView]                 = useState<ConfigView>('agents');
  const [routingDirty, setRoutingDirty] = useState(false);
  const [preferencesDirty, setPreferencesDirty] = useState(false);
  const [pendingNav, setPendingNav]     = useState<PendingNav | null>(null);
  const [promptOpen, setPromptOpen]     = useState(false);

  const anyDirty = configDirty || routingDirty || preferencesDirty;

  /** Resolve the config-file id for an agent's system-prompt .md. */
  const agentFileId = useCallback(
    (agentId: string): string | null => {
      const match = configFiles.find(
        (f) =>
          (f.scope === 'agent' || f.scope === 'space-agent') &&
          f.name.replace(/\.md$/i, '') === agentId
      );
      return match?.id ?? null;
    },
    [configFiles]
  );

  // Reload the file list on mount and whenever the active space changes.
  useEffect(() => {
    loadConfigFiles();
  }, [loadConfigFiles, activeSpaceId]);

  /** Called by ConfigFileSidebar when the user clicks a file. */
  const handleRequestSwitch = useCallback(
    (fileId: string) => {
      if (anyDirty) {
        setPendingNav({ type: 'file', fileId });
      } else {
        selectConfigFile(fileId);
      }
    },
    [anyDirty, selectConfigFile]
  );

  /** Called from an agent card — open its system prompt (.md) in a modal editor. */
  const handleEditPrompt = useCallback(
    (agentId: string) => {
      const fileId = agentFileId(agentId);
      if (!fileId) {
        showToast('No editable .md found for this agent', 'error');
        return;
      }
      // Already loaded (possibly with unsaved edits) → reopen without reloading.
      if (activeConfigFileId === fileId) {
        setPromptOpen(true);
        return;
      }
      // Switching to a different file while one is dirty → guard the discard.
      if (configDirty) {
        setPendingNav({ type: 'prompt', fileId });
        return;
      }
      selectConfigFile(fileId);
      setPromptOpen(true);
    },
    [agentFileId, activeConfigFileId, configDirty, selectConfigFile, showToast]
  );

  /** Called when the user clicks a view tab. */
  const handleRequestViewChange = useCallback(
    (newView: ConfigView) => {
      if (newView === view) return;
      if (anyDirty) {
        setPendingNav({ type: 'view', view: newView });
      } else {
        setView(newView);
      }
    },
    [view, anyDirty]
  );

  /** Called by the close button. */
  const handleRequestClose = useCallback(() => {
    if (anyDirty) {
      setPendingNav({ type: 'close' });
    } else {
      setConfigPanelOpen(false);
    }
  }, [anyDirty, setConfigPanelOpen]);

  /** User confirmed — discard changes and perform the pending navigation. */
  const handleDiscard = useCallback(() => {
    if (!pendingNav) return;
    setRoutingDirty(false);
    setPreferencesDirty(false);
    if (pendingNav.type === 'close') {
      setConfigPanelOpen(false);
    } else if (pendingNav.type === 'file') {
      setView('files');
      selectConfigFile(pendingNav.fileId);
    } else if (pendingNav.type === 'prompt') {
      selectConfigFile(pendingNav.fileId);
      setPromptOpen(true);
    } else {
      setView(pendingNav.view);
    }
    setPendingNav(null);
  }, [pendingNav, setConfigPanelOpen, selectConfigFile]);

  /** User cancelled the discard dialog. */
  const handleCancelDiscard = useCallback(() => {
    setPendingNav(null);
  }, []);

  return (
    <>
      <aside
        className="panel-shell relative flex flex-col bg-surface-elevated border-l border-border h-full shrink-0 w-[var(--panel-w)]"
        style={{ '--panel-w': `${width}px` } as React.CSSProperties} // lint-ok: CSS custom-property injection for dynamic panel resize — Tailwind cannot set runtime CSS vars at the element level
        aria-label="Configuration editor"
      >
        {/* Left-edge drag handle — ADR-1 (allow-resize-settings) §4 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          onMouseDown={handleMouseDown}
          className="panel-resize-handle absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors duration-150 z-10"
        />

        {/* Panel header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-text-secondary leading-none" aria-hidden="true">
              settings
            </span>
            <span className="text-sm font-medium text-text-primary">Configuration</span>
            {anyDirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
                aria-label="Unsaved changes"
              />
            )}
          </div>
          <button
            onClick={handleRequestClose}
            aria-label="Close configuration panel"
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant hover:text-text-primary transition-colors duration-150"
          >
            <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {/* View tabs */}
        <ConfigViewTabs view={view} onChange={handleRequestViewChange} />

        {/* Tab panels */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {view === 'agents' ? (
            /* Agents & Routing — full-width, Proposal D */
            <div
              id="config-tabpanel-agents"
              role="tabpanel"
              aria-labelledby="config-tab-agents"
              className="flex flex-col flex-1 min-w-0 overflow-hidden"
            >
              <AgentRoutingView onDirtyChange={setRoutingDirty} onEditPrompt={handleEditPrompt} />
            </div>
          ) : view === 'preferences' ? (
            /* Preferences — theme, CLI/prompt delivery, pipeline + prompt defaults */
            <div
              id="config-tabpanel-preferences"
              role="tabpanel"
              aria-labelledby="config-tab-preferences"
              className="flex flex-col flex-1 min-w-0 overflow-hidden"
            >
              <PreferencesView onDirtyChange={setPreferencesDirty} />
            </div>
          ) : (
            /* Files — original sidebar + editor */
            <div
              id="config-tabpanel-files"
              role="tabpanel"
              aria-labelledby="config-tab-files"
              className="flex flex-1 min-h-0 overflow-hidden w-full"
            >
              {/* File sidebar (Agents group and Model Routing virtual item removed) */}
              <div className="w-[140px] shrink-0 border-r border-border overflow-hidden">
                <ConfigFileSidebar onRequestSwitch={handleRequestSwitch} />
              </div>

              {/* Editor */}
              <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                <ConfigEditor />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* System-prompt editor — the agent's .md, opened from a routing card */}
      <Modal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        maxWidth="max-w-3xl"
        className="h-[80vh]"
        labelId="agent-prompt-title"
      >
        <ModalHeader onClose={() => setPromptOpen(false)}>
          <ModalTitle id="agent-prompt-title">System prompt</ModalTitle>
        </ModalHeader>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <ConfigEditor />
        </div>
      </Modal>

      {/* Discard-changes confirmation dialog */}
      <DiscardChangesDialog
        open={pendingNav !== null}
        onDiscard={handleDiscard}
        onCancel={handleCancelDiscard}
      />
    </>
  );
}
