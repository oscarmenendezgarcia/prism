/**
 * Agent settings panel — slide-over for configuring CLI tool, flags, and pipeline settings.
 * Follows the ConfigPanel pattern: width now dynamic via usePanelResize (was fixed w-[480px]).
 * ADR-1 (Agent Launcher) §3.3: GET/PUT /api/v1/settings.
 * ADR-1 (allow-resize-settings) §5.2: left-edge drag handle + localStorage persistence.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAppStore, useAgentSettings, useAgentSettingsPanelOpen } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { usePanelResize } from '@/hooks/usePanelResize';
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
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-hidden focus:ring-2 focus:ring-primary/50 ${
        checked ? 'bg-primary' : 'bg-surface-variant border border-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
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

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:agent-settings',
    defaultWidth: 480,
    minWidth:     320,
    maxWidth:     800,
  });

  const asideRef = useCallback(
    (node: HTMLElement | null) => {
      if (node) node.style.setProperty('--panel-w', `${width}px`);
    },
    [width],
  );

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
      ref={asideRef}
      className="relative flex flex-col bg-surface-elevated border-l border-border h-full shrink-0 w-[var(--panel-w)]"
      aria-label="Agent launcher settings"
    >
      {/* Left-edge drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors duration-fast z-10"
      />

      {/* Header */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[15px] leading-none text-primary" aria-hidden="true">
            tune
          </span>
          <span className="text-xs font-semibold text-text-primary tracking-wide">Agent Settings</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close agent settings panel"
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-variant transition-all duration-fast"
        >
          <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {!cli ? (
          <div className="flex items-center justify-center h-24">
            <p className="text-sm text-text-secondary">Loading settings…</p>
          </div>
        ) : (
          <div className="px-4 py-5 space-y-6">
            {/* CLI Tool section */}
            <section aria-labelledby="settings-cli-heading">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">smart_toy</span>
                <h3 id="settings-cli-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
                  AI Provider
                </h3>
              </div>
              <p className="text-xs text-text-secondary mb-3 leading-relaxed">
                The CLI used to run agents from the launcher and AI Actions (Generate tasks, Auto-tag).
              </p>

              <div className="space-y-1.5 mb-4">
                {CLI_TOOLS.map(({ value, label }) => (
                  <label
                    key={value}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-fast ${
                      cli.tool === value
                        ? 'bg-primary/[0.08] border border-primary/20'
                        : 'border border-transparent hover:bg-surface-variant'
                    }`}
                  >
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
                    <span className={`text-sm ${cli.tool === value ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                      {label}
                    </span>
                  </label>
                ))}
              </div>

              {cli.tool === 'custom' && (
                <div className="mb-4">
                  <label htmlFor="cli-binary" className="block text-xs text-text-secondary mb-1.5">
                    Binary path
                  </label>
                  <input
                    id="cli-binary"
                    type="text"
                    value={cli.binary}
                    onChange={(e) => setCli((c) => ({ ...c!, binary: e.target.value }))}
                    placeholder="/usr/local/bin/mycli"
                    className="w-full h-9 bg-surface border border-border rounded-lg px-3 text-sm font-mono text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:ring-1 focus:ring-primary/50 focus:border-primary/40 transition-all duration-fast"
                  />
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-text-secondary mb-1">Prompt delivery method</p>
                <p className="text-xs text-text-disabled mb-2">How the agent launcher passes the prompt file to the CLI.</p>
                <div className="space-y-1.5">
                  {FILE_METHODS.map(({ value, label }) => (
                    <label
                      key={value}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-fast ${
                        cli.fileInputMethod === value
                          ? 'bg-primary/[0.08] border border-primary/20'
                          : 'border border-transparent hover:bg-surface-variant'
                      }`}
                    >
                      <input
                        type="radio"
                        name="file-method"
                        value={value}
                        checked={cli.fileInputMethod === value}
                        onChange={() => setCli((c) => ({ ...c!, fileInputMethod: value }))}
                        className="accent-primary"
                      />
                      <span className="text-[11px] text-text-secondary font-mono">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            {/* Pipeline section */}
            {pipeline && (
              <section aria-labelledby="settings-pipeline-heading">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">account_tree</span>
                  <h3 id="settings-pipeline-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
                    Pipeline
                  </h3>
                </div>
                <p className="text-xs text-text-secondary mb-3 leading-relaxed">
                  Controls how multi-stage pipelines progress when launched from a task card.
                </p>

                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4 py-2">
                    <div>
                      <label htmlFor="toggle-auto-advance" className="text-sm text-text-primary cursor-pointer font-medium">
                        Auto-advance stages
                      </label>
                      <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                        Move to the next stage automatically once the current one completes.
                      </p>
                    </div>
                    <Toggle
                      id="toggle-auto-advance"
                      checked={pipeline.autoAdvance}
                      onChange={(v) => setPipeline((p) => ({ ...p!, autoAdvance: v }))}
                    />
                  </div>

                  <div className="h-px bg-border" aria-hidden="true" />

                  <div className="flex items-start justify-between gap-4 py-2">
                    <div>
                      <label htmlFor="toggle-confirm-stages" className="text-sm text-text-primary cursor-pointer font-medium">
                        Confirm between stages
                      </label>
                      <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                        Show a confirmation prompt before launching each subsequent stage.
                      </p>
                    </div>
                    <Toggle
                      id="toggle-confirm-stages"
                      checked={pipeline.confirmBetweenStages}
                      onChange={(v) => setPipeline((p) => ({ ...p!, confirmBetweenStages: v }))}
                    />
                  </div>

                  <div className="h-px bg-border" aria-hidden="true" />

                  <div className="py-2">
                    <p className="text-xs font-medium text-text-secondary mb-2">Default stage order</p>
                    <ol className="space-y-1.5">
                      {pipeline.stages.map((stage, idx) => (
                        <li key={stage} className="flex items-center gap-2.5 text-xs text-text-secondary">
                          <span className="w-5 h-5 rounded-full bg-primary/[0.10] text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0 border border-primary/20">
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

            {/* Agent Prompts section */}
            {prompts && (
              <section aria-labelledby="settings-prompts-heading">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">description</span>
                  <h3 id="settings-prompts-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
                    Agent Prompts
                  </h3>
                </div>
                <p className="text-xs text-text-secondary mb-3 leading-relaxed">
                  Extra context injected into every agent prompt when launching from a task card.
                </p>

                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4 py-2">
                    <div>
                      <label htmlFor="toggle-kanban-block" className="text-sm text-text-primary cursor-pointer font-medium">
                        Include Kanban instructions
                      </label>
                      <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                        Adds MCP tool usage instructions so agents can read and update the board.
                      </p>
                    </div>
                    <Toggle
                      id="toggle-kanban-block"
                      checked={prompts.includeKanbanBlock}
                      onChange={(v) => setPrompts((p) => ({ ...p!, includeKanbanBlock: v }))}
                    />
                  </div>

                  <div className="h-px bg-border" aria-hidden="true" />

                  <div className="flex items-start justify-between gap-4 py-2">
                    <div>
                      <label htmlFor="toggle-git-block" className="text-sm text-text-primary cursor-pointer font-medium">
                        Include Git instructions
                      </label>
                      <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                        Reminds agents to work on a feature branch and follow the commit convention.
                      </p>
                    </div>
                    <Toggle
                      id="toggle-git-block"
                      checked={prompts.includeGitBlock}
                      onChange={(v) => setPrompts((p) => ({ ...p!, includeGitBlock: v }))}
                    />
                  </div>

                  <div className="h-px bg-border" aria-hidden="true" />

                  <div className="py-2">
                    <label htmlFor="working-directory" className="block text-sm font-medium text-text-primary mb-0.5">
                      Working directory
                    </label>
                    <p className="text-xs text-text-secondary mb-2 leading-relaxed">
                      Default directory agents run in. Overridden by the space's own working directory when set.
                    </p>
                    <input
                      id="working-directory"
                      type="text"
                      value={prompts.workingDirectory}
                      onChange={(e) => setPrompts((p) => ({ ...p!, workingDirectory: e.target.value }))}
                      placeholder="Auto-detect from server cwd"
                      className="w-full h-9 bg-surface border border-border rounded-lg px-3 text-sm font-mono text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:ring-1 focus:ring-primary/50 focus:border-primary/40 transition-all duration-fast"
                    />
                  </div>
                </div>
              </section>
            )}

            {/* Custom Instructions section */}
            {prompts && (
              <section aria-labelledby="settings-custom-instructions-heading">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">edit_note</span>
                  <h3 id="settings-custom-instructions-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
                    Custom Instructions
                  </h3>
                </div>
                <p className="text-xs text-text-secondary mb-3 leading-relaxed">
                  Appended verbatim at the end of every agent prompt. Use it for project-wide conventions or constraints.
                </p>

                <div className="space-y-2">
                  <textarea
                    value={prompts.customInstructions}
                    onChange={(e) => setPrompts((p) => ({ ...p!, customInstructions: e.target.value }))}
                    rows={6}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:ring-1 focus:ring-primary/50 focus:border-primary/40 resize-none transition-all duration-fast"
                    placeholder="e.g. Always use TypeScript and follow the project's coding conventions."
                  />
                  {prompts?.customInstructions?.trim().length > 0 && (
                    <div className="bg-surface border border-border rounded-lg p-3 overflow-y-auto max-h-64">
                      <MarkdownViewer content={prompts.customInstructions} />
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || !cli}>
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>
    </aside>
  );
}
