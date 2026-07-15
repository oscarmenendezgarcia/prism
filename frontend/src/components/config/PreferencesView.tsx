/**
 * PreferencesView — the "Preferences" tab in ConfigPanel.
 *
 * Consolidates what used to be the standalone Agent Settings slide-over
 * (CLI tool, prompt delivery, pipeline toggles, agent prompts, custom
 * instructions) plus the app theme (previously a lone header icon) into one
 * tab, so there's a single place for "how agents run" + "how the app looks"
 * instead of a second panel that duplicated ConfigPanel's chrome.
 *
 * Follows the AgentRoutingView dirty-guard pattern: local draft state,
 * onDirtyChange callback so ConfigPanel's tab-switch/close guard covers this
 * tab too, and a sticky Save/Reset footer instead of a slide-over's Save/Cancel.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useTheme } from '@/hooks/useTheme';
import type { AgentSettings, CliSettings, PipelineSettings, PromptsSettings } from '@/types';

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

const THEME_LABEL: Record<string, string> = {
  system: 'Match system',
  light:  'Light',
  dark:   'Dark',
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

interface PreferencesViewProps {
  /** Notify parent whether any local edits exist (for the discard guard). */
  onDirtyChange: (dirty: boolean) => void;
}

export function PreferencesView({ onDirtyChange }: PreferencesViewProps) {
  const agentSettings = useAppStore((s) => s.agentSettings);
  const saveSettings  = useAppStore((s) => s.saveSettings);
  const { theme }     = useTheme();

  // Local draft state — only committed on Save.
  const [cli, setCli]           = useState<CliSettings | null>(null);
  const [pipeline, setPipeline] = useState<PipelineSettings | null>(null);
  const [prompts, setPrompts]   = useState<PromptsSettings | null>(null);
  const [dirty, setDirtyState]  = useState(false);
  const [saving, setSaving]     = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Sync from store when settings load/change (mirrors AgentRoutingView).
  useEffect(() => {
    if (agentSettings) {
      setCli({ ...agentSettings.cli });
      setPipeline({ ...agentSettings.pipeline });
      setPrompts({ ...agentSettings.prompts });
      setDirtyState(false);
    }
  }, [agentSettings]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const markDirty = useCallback(() => setDirtyState(true), []);

  const handleReset = useCallback(() => {
    if (agentSettings) {
      setCli({ ...agentSettings.cli });
      setPipeline({ ...agentSettings.pipeline });
      setPrompts({ ...agentSettings.prompts });
    }
    setDirtyState(false);
  }, [agentSettings]);

  const handleSave = async () => {
    if (!cli || !pipeline || !prompts) return;
    setSaving(true);
    try {
      const partial: Partial<AgentSettings> = { cli, pipeline, prompts };
      await saveSettings(partial);
      setDirtyState(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
    } finally {
      setSaving(false);
    }
  };

  if (!cli || !pipeline || !prompts) {
    return (
      <div className="flex items-center justify-center h-24">
        <p className="text-sm text-text-secondary">Loading settings…</p>
      </div>
    );
  }

  const saveLabel = saving ? 'Saving…' : justSaved ? 'Saved' : 'Save';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-5 space-y-6">
          {/* Theme section */}
          <section aria-labelledby="prefs-theme-heading">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">palette</span>
              <h3 id="prefs-theme-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
                Theme
              </h3>
            </div>
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="text-sm text-text-primary font-medium">Appearance</p>
                <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                  Currently: {THEME_LABEL[theme]}
                </p>
              </div>
              <ThemeToggle />
            </div>
          </section>

          {/* AI Provider section */}
          <section aria-labelledby="prefs-cli-heading">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">smart_toy</span>
              <h3 id="prefs-cli-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
                Prompt Delivery
              </h3>
            </div>
            <p className="text-xs text-text-secondary mb-3 leading-relaxed">
              How the agent launcher passes the prompt file to the CLI. Which CLI/model runs each
              agent is configured per-agent in the Agents &amp; Routing tab.
            </p>

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
                    onChange={() => { setCli((c) => ({ ...c!, fileInputMethod: value })); markDirty(); }}
                    className="accent-primary"
                  />
                  <span className="text-[11px] text-text-secondary font-mono">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Pipeline section */}
          <section aria-labelledby="prefs-pipeline-heading">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">account_tree</span>
              <h3 id="prefs-pipeline-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
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
                  onChange={(v) => { setPipeline((p) => ({ ...p!, autoAdvance: v })); markDirty(); }}
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
                  onChange={(v) => { setPipeline((p) => ({ ...p!, confirmBetweenStages: v })); markDirty(); }}
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

          {/* Agent Prompts section */}
          <section aria-labelledby="prefs-prompts-heading">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">description</span>
              <h3 id="prefs-prompts-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
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
                  onChange={(v) => { setPrompts((p) => ({ ...p!, includeKanbanBlock: v })); markDirty(); }}
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
                  onChange={(v) => { setPrompts((p) => ({ ...p!, includeGitBlock: v })); markDirty(); }}
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
                  onChange={(e) => { setPrompts((p) => ({ ...p!, workingDirectory: e.target.value })); markDirty(); }}
                  placeholder="Auto-detect from server cwd"
                  className="w-full h-9 bg-surface border border-border rounded-lg px-3 text-sm font-mono text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:ring-1 focus:ring-primary/50 focus:border-primary/40 transition-all duration-fast"
                />
              </div>
            </div>
          </section>

          {/* Custom Instructions section */}
          <section aria-labelledby="prefs-custom-instructions-heading">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="material-symbols-outlined text-[13px] leading-none text-text-secondary" aria-hidden="true">edit_note</span>
              <h3 id="prefs-custom-instructions-heading" className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
                Custom Instructions
              </h3>
            </div>
            <p className="text-xs text-text-secondary mb-3 leading-relaxed">
              Appended verbatim at the end of every agent prompt. Use it for project-wide conventions or constraints.
            </p>

            <div className="space-y-2">
              <textarea
                value={prompts.customInstructions}
                onChange={(e) => { setPrompts((p) => ({ ...p!, customInstructions: e.target.value })); markDirty(); }}
                rows={6}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:ring-1 focus:ring-primary/50 focus:border-primary/40 resize-none transition-all duration-fast"
                placeholder="e.g. Always use TypeScript and follow the project's coding conventions."
              />
              {prompts.customInstructions?.trim().length > 0 && (
                <div className="bg-surface border border-border rounded-lg p-3 overflow-y-auto max-h-64">
                  <MarkdownViewer content={prompts.customInstructions} />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0 flex justify-end gap-2">
        <Button variant="secondary" onClick={handleReset} disabled={!dirty || saving}>
          Reset
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!dirty || saving}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
