import type { StageModelsMap, StageModelConfig, ModelCliTool } from '../types';

// ---------------------------------------------------------------------------
// Effective-model resolution (Proposal D — Phase 1, no task context)
// ---------------------------------------------------------------------------

export type ModelSource = 'default' | 'global' | 'space' | 'task';

export interface EffectiveModel {
  model: string;
  source: ModelSource;
}

/**
 * Resolve the effective model and its inheritance source for one agent.
 *
 * Priority (Phase 1, no task context):
 *   space scope: spaceMap[agentId] → globalMap[agentId] → frontmatterModel → ''
 *   global scope: globalMap[agentId] → frontmatterModel → ''
 *
 * 'task' source is accepted by the badge component but is only set by TaskDetailPanel,
 * not by this resolver (which has no task context).
 *
 * @param agentId         Kebab-case agent identifier.
 * @param scope           The scope currently being edited ('global' | 'space').
 * @param globalMap       Global stageModels map from agentSettings.pipeline.stageModels.
 * @param spaceMap        Active space's stageModels (null / undefined when no space).
 * @param frontmatterModel Agent's default model from its frontmatter (may be undefined).
 */
export function resolveEffectiveModel(
  agentId: string,
  scope: 'global' | 'space',
  globalMap: StageModelsMap,
  spaceMap: StageModelsMap | null | undefined,
  frontmatterModel?: string,
): EffectiveModel {
  const defaultModel = frontmatterModel ?? '';

  if (scope === 'space') {
    const spaceEntry = spaceMap?.[agentId];
    if (spaceEntry?.model) return { model: spaceEntry.model, source: 'space' };

    const globalEntry = globalMap[agentId];
    if (globalEntry?.model) return { model: globalEntry.model, source: 'global' };

    return { model: defaultModel, source: 'default' };
  }

  // scope === 'global'
  const globalEntry = globalMap[agentId];
  if (globalEntry?.model) return { model: globalEntry.model, source: 'global' };

  return { model: defaultModel, source: 'default' };
}

/** One agent's local routing edit (model + CLI tool). */
export interface RoutingEntry {
  model:   string;
  cliTool: ModelCliTool;
}

/** True when an opencode model string is in the required `provider/model` format. */
export function isValidOpencodeModel(model: string): boolean {
  return model.trim().includes('/');
}

/**
 * Build a single {@link StageModelConfig} for one agent, or `null` to clear the
 * override when the model is blank.
 *
 * - `claude`   → `{ provider: 'claude', model, cliTool: 'claude' }`
 * - `opencode` → provider is the segment before the first `/` (MODEL-2 stores an
 *   open-ended provider; the runtime only consumes `model`), e.g.
 *   `vllm-local/qwen2.5-coder` → `{ provider: 'vllm-local', model, cliTool: 'opencode' }`
 * - `custom`   → `{ provider: 'custom', model, cliTool: 'custom' }`
 */
export function buildStageModelConfig(
  model: string,
  cliTool: ModelCliTool = 'claude',
): StageModelConfig | null {
  const trimmed = model.trim();
  if (!trimmed) return null; // null = clear override

  if (cliTool === 'opencode') {
    const provider = trimmed.split('/')[0] || 'opencode';
    return { provider, model: trimmed, cliTool: 'opencode' };
  }
  if (cliTool === 'custom') {
    return { provider: 'custom', model: trimmed, cliTool: 'custom' };
  }
  return { provider: 'claude', model: trimmed, cliTool: 'claude' };
}

/**
 * Convert the UI's flat `agentId → model-string` map into a {@link StageModelsMap}.
 *
 * Model-only callers (SpaceModal, TaskDetailPanel) where the CLI tool is always
 * `'claude'`. A blank/whitespace model string becomes `null` (clear the override).
 */
export function localModelsToStageModelsMap(
  localStageModels: Record<string, string>,
): StageModelsMap {
  const stageModels: StageModelsMap = {};
  for (const [agentId, model] of Object.entries(localStageModels)) {
    stageModels[agentId] = buildStageModelConfig(model, 'claude');
  }
  return stageModels;
}

/**
 * Convert the AgentRoutingView's `agentId → {model, cliTool}` map into a
 * {@link StageModelsMap}, preserving the per-agent CLI tool (claude / opencode).
 */
export function localRoutingToStageModelsMap(
  localRouting: Record<string, RoutingEntry>,
): StageModelsMap {
  const stageModels: StageModelsMap = {};
  for (const [agentId, entry] of Object.entries(localRouting)) {
    stageModels[agentId] = buildStageModelConfig(entry.model, entry.cliTool);
  }
  return stageModels;
}
