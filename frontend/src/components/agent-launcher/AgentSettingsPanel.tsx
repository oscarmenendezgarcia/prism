/**
 * Agent settings panel — slide-over for configuring CLI tool, flags, and pipeline settings.
 * Follows the ConfigPanel pattern: fixed w-[480px], border-l, bg-surface-elevated.
 * ADR-1 (Agent Launcher) §3.3: GET/PUT /api/v1/settings.
 */

import React, { useEffect, useState } from 'react';
import { useAppStore, useAgentSettings, useAgentSettingsPanelOpen } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import type { AgentSettings, CliSettings, PipelineSettings, PromptsSettings } from '@/types';

const CLI_TOOLS = [
  { value: 'claude',   label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'custom',   label: 'Custom' },
] as const;

const FILE_METHODS = [
  { value: 'cat-subshell',   label: '$(cat /path)  — bash/zsh subshell (default)' },
  { value: 'stdin-redirect', label: '< /path  — stdin redirect' },
  { value: 'flag-file',      label: '--file /path  — file flag' },
] as const;

const STAGE_LABELS: Record<string, string> = {
  'senior-architect': 'Senior Architect',
  'ux-api-designer':  'UX & API Designer',
  'developer-agent':  'Developer',
  'qa-engineer-e2e':  'QA Engineer',
};

/** Simple toggle switch component. */
function Toggle({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
        checked ? 'bg-primary' : 'bg-surface-variant border border-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function AgentSettingsPanel() {
  const open            = useAgentSettingsPanelOpen();
  const agentSettings   = useAgentSettings();
  const setOpen         = useAppStore((s) => s.setAgentSettingsPanelOpen);
  const saveSettings    = useAppStore((s) => s.saveSettings);

  // Local draft state — only committed on Save.
  const [cli, setCli]           = useState<CliSettings | null>(null);
  const [pipeline, setPipeline] = useState<PipelineSettings | null>(null);
  const [prompts, setPrompts]   = useState<PromptsSettings | null>(null);
  const [saving, setSaving]     = useState(false);

  // Reset local draft when panel opens or settings load.
  useEffect(() => {
    if (agentSettings) {
      setCli({ ...agentSettings.cli });
      setPipeline({ ...agentSettings.pipeline });
      setPrompts({ ...agentSettings.prompts });
    }
  }, [agentSettings, open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!cli || !pipeline || !prompts) return;
    setSaving(true);
    try {
      const partial: Partial<AgentSettings> = { cli, pipeline, prompts };
      await saveSettings(partial);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      className="flex flex-col bg-surface-elevated border-l border-border h-full w-[480px] shrink-0"
      aria-label="Agent launcher settings"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-lg text-text-secondary leading-none"
            aria-hidden="true"
          >
            settings
          </span>
          <span className="text-sm font-medium text-text-primary">Agent Settings</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close agent settings panel"
          className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant hover:text-text-primary transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {!cli ? (
          <p className="text-sm text-text-secondary">Loading settings...</p>
        ) : (
          <>
            {/* CLI Tool section */}
            <section aria-labelledby="settings-cli-heading">
              <h3
                id="settings-cli-heading"
                className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3"
              >
                CLI Tool
              </h3>

              <div className="space-y-2 mb-4">
                {CLI_TOOLS.map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="cli-tool"
                      value={value}
                      checked={cli.tool === value}
                      onChange={() =>
                        setCli((c) => ({
                          ...c!,
                          tool:   value,
                          binary: value === 'custom' ? c!.binary : value,
                        }))
                      }
                      className="accent-primary"
                    />
                    <span className="text-sm text-text-primary">{label}</span>
                  </label>
                ))}
              </div>

              {/* Custom binary path */}
              {cli.tool === 'custom' && (
                <div className="mb-4">
                  <label
                    htmlFor="cli-binary"
                    className="block text-xs text-text-secondary mb-1"
                  >
                    Binary path
                  </label>
                  <input
                    id="cli-binary"
                    type="text"
                    value={cli.binary}
                    onChange={(e) => setCli((c) => ({ ...c!, binary: e.target.value }))}
                    placeholder="/usr/local/bin/mycli"
                    className="w-full h-9 bg-surface-variant border border-border rounded-md px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              )}

              {/* Additional flags */}
              <div className="mb-4">
                <label
                  htmlFor="cli-flags"
                  className="block text-xs text-text-secondary mb-1"
                >
                  Additional flags
                </label>
                <input
                  id="cli-flags"
                  type="text"
                  value={cli.flags.join(' ')}
                  onChange={(e) =>
                    setCli((c) => ({
                      ...c!,
                      flags: e.target.value.split(/\s+/).filter(Boolean),
                    }))
                  }
                  placeholder='--allowedTools "Agent,Bash,Read,Write,Edit"'
                  className="w-full h-9 bg-surface-variant border border-border rounded-md px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>

              {/* Prompt delivery method */}
              <div>
                <p className="text-xs text-text-secondary mb-2">Prompt delivery method</p>
                <div className="space-y-2">
                  {FILE_METHODS.map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="file-method"
                        value={value}
                        checked={cli.fileInputMethod === value}
                        onChange={() =>
                          setCli((c) => ({ ...c!, fileInputMethod: value }))
                        }
                        className="accent-primary"
                      />
                      <span className="text-xs text-text-primary font-mono">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            {/* Pipeline section */}
            {pipeline && (
              <section aria-labelledby="settings-pipeline-heading">
                <h3
                  id="settings-pipeline-heading"
                  className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3"
                >
                  Pipeline
                </h3>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="toggle-auto-advance"
                      className="text-sm text-text-primary cursor-pointer"
                    >
                      Auto-advance stages
                    </label>
                    <Toggle
                      id="toggle-auto-advance"
                      checked={pipeline.autoAdvance}
                      onChange={(v) => setPipeline((p) => ({ ...p!, autoAdvance: v }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="toggle-confirm-stages"
                      className="text-sm text-text-primary cursor-pointer"
                    >
                      Confirm between stages
                    </label>
                    <Toggle
                      id="toggle-confirm-stages"
                      checked={pipeline.confirmBetweenStages}
                      onChange={(v) =>
                        setPipeline((p) => ({ ...p!, confirmBetweenStages: v }))
                      }
                    />
                  </div>

                  {/* Stage order (read-only) */}
                  <div>
                    <p className="text-xs text-text-secondary mb-2">Stage order (read-only)</p>
                    <ol className="space-y-1">
                      {pipeline.stages.map((stage, idx) => (
                        <li
                          key={stage}
                          className="flex items-center gap-2 text-xs text-text-secondary"
                        >
                          <span className="w-4 h-4 rounded-full bg-primary/[0.12] text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {idx + 1}
                          </span>
                          {STAGE_LABELS[stage] ?? stage}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </section>
            )}

            {/* Prompt content section */}
            {prompts && (
              <section aria-labelledby="settings-prompts-heading">
                <h3
                  id="settings-prompts-heading"
                  className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3"
                >
                  Prompt Content
                </h3>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="toggle-kanban-block"
                      className="text-sm text-text-primary cursor-pointer"
                    >
                      Include Kanban instructions
                    </label>
                    <Toggle
                      id="toggle-kanban-block"
                      checked={prompts.includeKanbanBlock}
                      onChange={(v) =>
                        setPrompts((p) => ({ ...p!, includeKanbanBlock: v }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="toggle-git-block"
                      className="text-sm text-text-primary cursor-pointer"
                    >
                      Include Git instructions
                    </label>
                    <Toggle
                      id="toggle-git-block"
                      checked={prompts.includeGitBlock}
                      onChange={(v) =>
                        setPrompts((p) => ({ ...p!, includeGitBlock: v }))
                      }
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="working-directory"
                      className="block text-sm text-text-primary mb-1"
                    >
                      Working directory
                    </label>
                    <input
                      id="working-directory"
                      type="text"
                      value={prompts.workingDirectory}
                      onChange={(e) =>
                        setPrompts((p) => ({ ...p!, workingDirectory: e.target.value }))
                      }
                      placeholder="Auto-detect from server cwd"
                      className="w-full h-9 bg-surface-variant border border-border rounded-md px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || !cli}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </aside>
  );
}
