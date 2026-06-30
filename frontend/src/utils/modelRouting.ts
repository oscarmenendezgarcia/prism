import type { StageModelsMap } from '../types';

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

/**
 * Convert the UI's flat `agentId → model-string` map into a {@link StageModelsMap}.
 *
 * A blank/whitespace model string becomes `null` (clear that agent's override).
 * `provider` and `cliTool` are fixed to `'claude'` in MODEL-1 — widen this when
 * MODEL-2 wires per-tool binary resolution.
 */
export function localModelsToStageModelsMap(
  localStageModels: Record<string, string>,
): StageModelsMap {
  const stageModels: StageModelsMap = {};
  for (const [agentId, model] of Object.entries(localStageModels)) {
    const trimmedModel = model.trim();
    stageModels[agentId] = trimmedModel
      ? { provider: 'claude', model: trimmedModel, cliTool: 'claude' }
      : null; // null = clear override
  }
  return stageModels;
}
