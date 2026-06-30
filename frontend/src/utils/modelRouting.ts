import type { StageModelsMap } from '../types';

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
