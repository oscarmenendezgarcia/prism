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

/** One agent's local routing edit (model + CLI tool + optional fallback harness). */
export interface RoutingEntry {
  model:   string;
  cliTool: ModelCliTool;
  /** Optional fallback harness used when the primary binary is missing. */
  fallback?: RoutingFallback | null;
}

/** A fallback harness choice: a cliTool + (for slash harnesses) a model. */
export interface RoutingFallback {
  cliTool: ModelCliTool;
  model?: string;
}

/**
 * Harnesses whose model string must be in `<provider>/<model>` format
 * (mirrors backend `SLASH_MODEL_CLI_TOOLS` in modelConfigResolver.js).
 */
export const SLASH_MODEL_CLI_TOOLS: readonly ModelCliTool[] =
  ['opencode', 'pi', 'hermes'];

/** True when the harness requires a `provider/model` model string. */
export function isSlashModelHarness(cliTool: ModelCliTool): boolean {
  return SLASH_MODEL_CLI_TOOLS.includes(cliTool);
}

/** True when a model string is in the `provider/model` format (slash harnesses). */
export function isValidSlashModel(model: string): boolean {
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
/**
 * Build the {@link StageModelConfig.fallback} fragment from a routing fallback
 * entry. Slash-model harnesses (opencode/pi/hermes) carry the provider derived
 * from the model prefix for backend validation. Returns null when unset.
 */
export function buildFallbackConfig(
  fallback?: RoutingFallback | null,
): StageModelConfig['fallback'] {
  if (!fallback || !fallback.cliTool) return null;
  const model = fallback.model?.trim();
  const fb: NonNullable<StageModelConfig['fallback']> = { cliTool: fallback.cliTool };
  if (model) {
    if (isSlashModelHarness(fallback.cliTool)) {
      fb.provider = model.split('/')[0] || fallback.cliTool;
    }
    fb.model = model;
  }
  return fb;
}

export function buildStageModelConfig(
  model: string,
  cliTool: ModelCliTool = 'claude',
  fallback?: RoutingFallback | null,
): StageModelConfig | null {
  const trimmed = model.trim();
  if (!trimmed && !fallback) return null; // nothing set → clear override

  const fb = buildFallbackConfig(fallback);

  let cfg: StageModelConfig;
  if (cliTool === 'custom') {
    cfg = { provider: 'custom', model: trimmed, cliTool: 'custom' };
  } else if (isSlashModelHarness(cliTool)) {
    // opencode / pi / hermes — provider is the segment before the first '/'
    // (runtime only consumes `model`; the provider is carried for validation).
    const provider = trimmed.split('/')[0] || cliTool;
    cfg = { provider, model: trimmed, cliTool };
  } else {
    cfg = { provider: 'claude', model: trimmed, cliTool: 'claude' };
  }

  if (fb) cfg.fallback = fb;
  return cfg;
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
 * {@link StageModelsMap}, preserving the per-agent CLI tool (claude / opencode)
 * and the declared fallback harness.
 */
export function localRoutingToStageModelsMap(
  localRouting: Record<string, RoutingEntry>,
): StageModelsMap {
  const stageModels: StageModelsMap = {};
  for (const [agentId, entry] of Object.entries(localRouting)) {
    stageModels[agentId] = buildStageModelConfig(entry.model, entry.cliTool, entry.fallback);
  }
  return stageModels;
}
