/**
 * Textarea-based config file editor.
 * ADR-1 (Config Editor Panel): plain <textarea> with JetBrains Mono (font-mono),
 * no external editor library. Supports Ctrl+S / Cmd+S to save.
 *
 * Shows:
 *   - Mini-header: file name + scope badge
 *   - Textarea: fills remaining vertical space
 *   - Footer: "Unsaved changes" indicator + Save button (disabled when clean)
 */

import React, { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';

export function ConfigEditor() {
  const activeConfigFileId  = useAppStore((s) => s.activeConfigFileId);
  const activeConfigContent = useAppStore((s) => s.activeConfigContent);
  const configDirty         = useAppStore((s) => s.configDirty);
  const configLoading       = useAppStore((s) => s.configLoading);
  const configSaving        = useAppStore((s) => s.configSaving);
  const configFiles         = useAppStore((s) => s.configFiles);
  const setConfigContent    = useAppStore((s) => s.setConfigContent);
  const saveConfigFile      = useAppStore((s) => s.saveConfigFile);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea whenever a new file is selected.
  useEffect(() => {
    if (activeConfigFileId && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [activeConfigFileId]);

  // Ctrl+S / Cmd+S keyboard shortcut.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (configDirty && !configSaving) {
          saveConfigFile();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [configDirty, configSaving, saveConfigFile]);

  // Empty state — no file selected.
  if (!activeConfigFileId) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-6">
        <span className="material-symbols-outlined text-4xl text-text-secondary" aria-hidden="true">
          description
        </span>
        <p className="text-sm text-text-secondary">Select a file to edit</p>
      </div>
    );
  }

  const activeFile = configFiles.find((f) => f.id === activeConfigFileId);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Mini-header: file name + scope badge */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium text-text-primary truncate flex-1">
          {activeFile?.name ?? activeConfigFileId}
        </span>
        {activeFile && (
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              activeFile.scope === 'global'
                ? 'bg-primary/[0.12] text-primary'
                : 'bg-success/[0.15] text-success'
            }`}
          >
            {activeFile.scope}
          </span>
        )}
        {configLoading && (
          <span className="material-symbols-outlined text-base text-text-secondary animate-spin" aria-hidden="true">
            progress_activity
          </span>
        )}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={activeConfigContent}
        onChange={(e) => setConfigContent(e.target.value)}
        disabled={configLoading || configSaving}
        spellCheck={false}
        aria-label={`Edit ${activeFile?.name ?? activeConfigFileId}`}
        className="flex-1 min-h-0 w-full resize-none bg-transparent text-text-primary font-mono text-xs leading-relaxed px-3 py-2 outline-none placeholder:text-text-secondary disabled:opacity-60 overflow-auto"
      />

      {/* Footer: dirty indicator + Save button */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border shrink-0 gap-2">
        <span
          className={`text-xs transition-opacity duration-150 ${
            configDirty ? 'text-warning opacity-100' : 'opacity-0'
          }`}
          aria-live="polite"
          aria-atomic="true"
        >
          Unsaved changes
        </span>

        <Button
          variant="primary"
          disabled={!configDirty || configSaving}
          onClick={saveConfigFile}
          aria-label="Save file"
          className="shrink-0"
        >
          {configSaving ? (
            <span className="material-symbols-outlined text-base leading-none animate-spin" aria-hidden="true">
              progress_activity
            </span>
          ) : (
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
              save
            </span>
          )}
          Save
        </Button>
      </div>
    </div>
  );
}
