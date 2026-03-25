/**
 * Sidebar listing available config files grouped by scope (Global / Project).
 * ADR-1 (Config Editor Panel): files are read-only descriptors from the server;
 * clicking a file calls selectConfigFile from the store.
 * Dirty guard: if configDirty is true, shows a discard confirmation before
 * switching to a different file (handled via onRequestSwitch callback from parent).
 */

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { ConfigFile } from '@/types';

interface ConfigFileSidebarProps {
  /**
   * Called when the user clicks a file item.
   * The parent is responsible for showing the discard dialog if needed;
   * it calls this with the target fileId only when the switch should proceed.
   */
  onRequestSwitch: (fileId: string) => void;
}

/** Section heading with consistent label styling. */
function ScopeHeading({ label }: { label: string }) {
  return (
    <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-secondary select-none">
      {label}
    </p>
  );
}

/** Single file entry in the sidebar list. */
function FileItem({
  file,
  isActive,
  onClick,
}: {
  file: ConfigFile;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      title={file.directory}
      className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors duration-100 ${
        isActive
          ? 'bg-primary/[0.12] text-primary'
          : 'text-text-primary hover:bg-surface-variant'
      }`}
    >
      <span className="text-xs font-medium leading-tight truncate">{file.name}</span>
      <span className="text-[10px] text-text-secondary leading-tight truncate">{file.directory}</span>
    </button>
  );
}

export function ConfigFileSidebar({ onRequestSwitch }: ConfigFileSidebarProps) {
  const configFiles        = useAppStore((s) => s.configFiles);
  const activeConfigFileId = useAppStore((s) => s.activeConfigFileId);
  const configLoading      = useAppStore((s) => s.configLoading);

  const globalFiles  = configFiles.filter((f) => f.scope === 'global');
  const agentFiles   = configFiles.filter((f) => f.scope === 'agent' || f.scope === 'space-agent');
  const projectFiles = configFiles.filter((f) => f.scope === 'project' || f.scope === 'space-project');

  if (configLoading && configFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="material-symbols-outlined text-2xl text-text-secondary animate-spin" aria-hidden="true">
          progress_activity
        </span>
      </div>
    );
  }

  if (configFiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-3 text-center">
        <span className="material-symbols-outlined text-2xl text-text-secondary" aria-hidden="true">
          folder_off
        </span>
        <p className="text-xs text-text-secondary">No config files found</p>
      </div>
    );
  }

  return (
    <nav
      aria-label="Config files"
      className="flex flex-col overflow-y-auto h-full"
    >
      {globalFiles.length > 0 && (
        <div>
          <ScopeHeading label="Global" />
          {globalFiles.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              isActive={file.id === activeConfigFileId}
              onClick={() => onRequestSwitch(file.id)}
            />
          ))}
        </div>
      )}

      {agentFiles.length > 0 && (
        <div>
          <ScopeHeading label="Agents" />
          {agentFiles.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              isActive={file.id === activeConfigFileId}
              onClick={() => onRequestSwitch(file.id)}
            />
          ))}
        </div>
      )}

      {projectFiles.length > 0 && (
        <div>
          <ScopeHeading label="Project" />
          {projectFiles.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              isActive={file.id === activeConfigFileId}
              onClick={() => onRequestSwitch(file.id)}
            />
          ))}
        </div>
      )}
    </nav>
  );
}
