/**
 * MODEL-1 — ModelRoutingSettings
 *
 * Global settings panel for per-stage model routing.
 * Rendered inside ConfigPanel when the user selects the "Model Routing" virtual item.
 */

import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import type { StageModelConfig, StageModelsMap } from '@/types';

const CLAUDE_PRESETS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
const DEFAULT_PROVIDER = 'claude' as const;
const DEFAULT_CLI_TOOL = 'claude' as const;

/** Agent color dots — match existing RunIndicator / StageTabBar color tokens. */
const AGENT_COLORS: Record<string, string> = {
  'senior-architect': 'bg-agent-architect',
  'ux-api-designer':  'bg-agent-ux',
  'developer-agent':  'bg-agent-dev',
  'code-reviewer':    'bg-agent-review',
  'qa-engineer-e2e':  'bg-agent-qa',
};

export function ModelRoutingSettings() {
  const agentSettings = useAppStore((s) => s.agentSettings);
  const saveSettings  = useAppStore((s) => s.saveSettings);
  const showToast     = useAppStore((s) => s.showToast);

  const stages = agentSettings?.pipeline?.stages ?? [];

  const [localStageModels, setLocalStageModels] = useState<StageModelsMap>({});
  const [saving, setSaving] = useState(false);
  const [dirty,  setDirty]  = useState(false);

  // Sync from store when settings load or change.
  useEffect(() => {
    setLocalStageModels(agentSettings?.pipeline?.stageModels ?? {});
    setDirty(false);
  }, [agentSettings?.pipeline?.stageModels]);

  function getModelForStage(agentId: string): string {
    return localStageModels[agentId]?.model ?? '';
  }

  function setModelForStage(agentId: string, model: string) {
    const trimmed = model.trim();
    if (!trimmed) {
      const next = { ...localStageModels };
      delete next[agentId];
      setLocalStageModels(next);
    } else {
      setLocalStageModels((prev) => ({
        ...prev,
        [agentId]: { provider: DEFAULT_PROVIDER, model: trimmed, cliTool: DEFAULT_CLI_TOOL } satisfies StageModelConfig,
      }));
    }
    setDirty(true);
  }

  function clearStage(agentId: string) {
    const next = { ...localStageModels };
    delete next[agentId];
    setLocalStageModels(next);
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveSettings({ pipeline: { stageModels: localStageModels } } as any);
      showToast('Model routing saved', 'success');
      setDirty(false);
    } catch {
      showToast('Failed to save model config', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setLocalStageModels({});
    setDirty(true);
  }

  if (!stages || stages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-12 px-6 text-center">
        <span className="material-symbols-outlined text-3xl text-text-secondary" aria-hidden="true">model_training</span>
        <p className="text-sm text-text-secondary">
          No pipeline stages configured.<br />
          Add agents to pipeline settings to see model options here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-lg text-primary leading-none" aria-hidden="true">model_training</span>
          <h2 className="text-sm font-semibold text-text-primary">Model Routing</h2>
          <span className="text-xs text-text-secondary bg-surface px-1.5 py-0.5 rounded font-mono uppercase border border-border">GLOBAL</span>
        </div>
        <p className="text-xs text-text-secondary">
          Configure which AI model runs each stage. Changes apply to the next run.
        </p>
      </div>

      {/* Stage rows */}
      <div className="flex-1 px-4 py-3 flex flex-col gap-4 overflow-y-auto">
        {stages.map((agentId) => {
          const currentModel = getModelForStage(agentId);
          const isPreset     = CLAUDE_PRESETS.includes(currentModel);
          const hasOverride  = !!localStageModels[agentId];
          const dotColor     = AGENT_COLORS[agentId] ?? 'bg-primary';

          return (
            <fieldset key={agentId} className="border-0 p-0 m-0">
              <legend className="flex items-center gap-2 mb-2 w-full">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />
                <span className="text-xs font-medium text-text-primary font-mono">{agentId}</span>
                {hasOverride && (
                  <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">override</span>
                )}
              </legend>

              {/* Preset chips */}
              <div className="flex flex-wrap gap-1.5 mb-2" role="radiogroup" aria-label={`Model presets for ${agentId}`}>
                {CLAUDE_PRESETS.map((preset) => {
                  const short      = preset.replace('claude-', '');
                  const isSelected = currentModel === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setModelForStage(agentId, preset)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-all duration-100 ${
                        isSelected
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface border-border text-text-secondary hover:border-primary/50 hover:text-text-primary'
                      }`}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>

              {/* Custom model input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label={`Custom model for ${agentId}`}
                  placeholder={isPreset ? '' : (currentModel || 'Custom model string…')}
                  value={!isPreset ? currentModel : ''}
                  onChange={(e) => setModelForStage(agentId, e.target.value)}
                  className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary transition-all duration-100 font-mono"
                />
                {hasOverride && (
                  <button
                    type="button"
                    aria-label={`Clear override for ${agentId}`}
                    onClick={() => clearStage(agentId)}
                    className="text-text-secondary hover:text-error transition-colors text-xs px-2 py-1.5 rounded hover:bg-surface-variant shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
            </fieldset>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0 flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={saving || !dirty}
            onClick={handleSave}
            aria-busy={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="ghost" onClick={handleReset} disabled={saving}>
            Reset to defaults
          </Button>
        </div>
        <p className="text-[10px] text-text-secondary">
          Changes apply to the next run only. Existing runs are unaffected.
        </p>
      </div>
    </div>
  );
}
