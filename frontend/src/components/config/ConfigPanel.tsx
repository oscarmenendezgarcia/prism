/**
 * Config editor panel — slide-over with file sidebar + editor area.
 * ADR-1 §5.1: fixed width w-[480px], border-l border-border, bg-surface-elevated.
 * Matches the TerminalPanel pattern structurally.
 *
 * Responsibilities:
 *   - Load file list on mount (useEffect → loadConfigFiles).
 *   - Route sidebar file-switch requests through the dirty guard.
 *   - Route close-button through the dirty guard.
 *   - Show DiscardChangesDialog when pending navigation is blocked by dirty state.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { ConfigFileSidebar } from '@/components/config/ConfigFileSidebar';
import { ConfigEditor } from '@/components/config/ConfigEditor';
import { DiscardChangesDialog } from '@/components/config/DiscardChangesDialog';

export function ConfigPanel() {
  const setConfigPanelOpen = useAppStore((s) => s.setConfigPanelOpen);
  const loadConfigFiles    = useAppStore((s) => s.loadConfigFiles);
  const selectConfigFile   = useAppStore((s) => s.selectConfigFile);
  const configDirty        = useAppStore((s) => s.configDirty);

  /**
   * Pending file ID for which the user has not yet confirmed discarding changes.
   * null = no pending navigation; 'close' = user wants to close the panel.
   */
  const [pendingFileId, setPendingFileId] = useState<string | 'close' | null>(null);
  const discardDialogOpen = pendingFileId !== null;

  // Load the file list once when the panel mounts.
  useEffect(() => {
    loadConfigFiles();
  }, [loadConfigFiles]);

  /** Called by ConfigFileSidebar when the user clicks a file. */
  const handleRequestSwitch = useCallback(
    (fileId: string) => {
      if (configDirty) {
        setPendingFileId(fileId);
      } else {
        selectConfigFile(fileId);
      }
    },
    [configDirty, selectConfigFile]
  );

  /** Called by the close button. */
  const handleRequestClose = useCallback(() => {
    if (configDirty) {
      setPendingFileId('close');
    } else {
      setConfigPanelOpen(false);
    }
  }, [configDirty, setConfigPanelOpen]);

  /** User confirmed — discard changes and perform the pending navigation. */
  const handleDiscard = useCallback(() => {
    if (pendingFileId === 'close') {
      setConfigPanelOpen(false);
    } else if (pendingFileId) {
      selectConfigFile(pendingFileId);
    }
    setPendingFileId(null);
  }, [pendingFileId, setConfigPanelOpen, selectConfigFile]);

  /** User cancelled the discard dialog. */
  const handleCancelDiscard = useCallback(() => {
    setPendingFileId(null);
  }, []);

  return (
    <>
      <aside
        className="flex flex-col bg-surface-elevated border-l border-border h-full w-[480px] shrink-0"
        aria-label="Configuration editor"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-text-secondary leading-none" aria-hidden="true">
              settings
            </span>
            <span className="text-sm font-medium text-text-primary">Configuration</span>
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

        {/* Body: sidebar (~140px) + editor (flex-1) */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* File sidebar */}
          <div className="w-[140px] shrink-0 border-r border-border overflow-hidden">
            <ConfigFileSidebar onRequestSwitch={handleRequestSwitch} />
          </div>

          {/* Editor */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <ConfigEditor />
          </div>
        </div>
      </aside>

      {/* Discard-changes confirmation dialog */}
      <DiscardChangesDialog
        open={discardDialogOpen}
        onDiscard={handleDiscard}
        onCancel={handleCancelDiscard}
      />
    </>
  );
}
