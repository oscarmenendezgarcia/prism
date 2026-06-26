'use strict';

/**
 * MODEL-1 — ModelConfigResolver
 *
 * Resolves the effective model/provider/cliTool for a given pipeline stage.
 * Inheritance order (lowest → highest priority):
 *   frontmatter (agent .md file) → settings (global) → space → task
 */

// MODEL-1: claude is the only wired CLI tool. MODEL-2 adds 'opencode'.
// VALID_PROVIDERS is a whitelist for the 'claude' cliTool only.
// For 'opencode', the provider string is open-ended (defined in opencode.jsonc)
// and validated only for non-emptiness.
const VALID_PROVIDERS = ['claude'];
const VALID_CLI_TOOLS = ['claude', 'opencode', 'custom'];

/**
 * Resolve effective model config for a stage.
 *
 * @param {string}      agentId     - Agent ID (e.g. 'senior-architect').
 * @param {object|null} agentSpec   - Parsed agent spec from agentResolver (may have .model).
 * @param {object|null} settings    - Global settings object (may have .pipeline.stageModels).
 * @param {object|null} spaceModels - Space-level stageModels map (agentId → config).
 * @param {object|null} taskModels  - Task-level stageModels map (agentId → config).
 * @returns {{ provider: string, model: string, cliTool: string, resolvedFrom: string }}
 */
function resolveStageModelConfig(agentId, agentSpec, settings, spaceModels, taskModels) {
  const base = {
    provider: 'claude',
    model:    (agentSpec && agentSpec.model) ? agentSpec.model : 'claude-sonnet-4-5',
    cliTool:  'claude',
  };

  let resolvedFrom = 'frontmatter';
  let current = { ...base };

  // Layer 1: global settings
  const settingsModels = settings && settings.pipeline && settings.pipeline.stageModels;
  if (settingsModels && settingsModels[agentId] && typeof settingsModels[agentId] === 'object') {
    current = { ...current, ...settingsModels[agentId] };
    resolvedFrom = 'settings';
  }

  // Layer 2: space overrides
  if (spaceModels && spaceModels[agentId] && typeof spaceModels[agentId] === 'object') {
    current = { ...current, ...spaceModels[agentId] };
    resolvedFrom = 'space';
  }

  // Layer 3: task overrides (highest priority)
  if (taskModels && taskModels[agentId] && typeof taskModels[agentId] === 'object') {
    current = { ...current, ...taskModels[agentId] };
    resolvedFrom = 'task';
  }

  return {
    provider:     current.provider || 'claude',
    model:        current.model    || base.model,
    cliTool:      current.cliTool  || 'claude',
    resolvedFrom,
  };
}

/**
 * Validate a StageModelConfig entry.
 *
 * @param {unknown} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateStageModelConfig(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['stageModels entry must be a non-null object'] };
  }
  const errors = [];

  if ('cliTool' in config) {
    if (!VALID_CLI_TOOLS.includes(config.cliTool)) {
      errors.push(`Invalid cliTool '${config.cliTool}'. Valid CLI tools are: ${VALID_CLI_TOOLS.join(', ')}.`);
    }
  }

  if ('provider' in config) {
    if (config.cliTool === 'opencode') {
      // opencode providers are user-defined in opencode.jsonc — accept any non-empty string.
      if (typeof config.provider !== 'string' || config.provider.trim().length === 0) {
        errors.push('provider must be a non-empty string.');
      }
    } else {
      // claude (or unspecified cliTool): strict whitelist.
      if (!VALID_PROVIDERS.includes(config.provider)) {
        errors.push(`Invalid provider '${config.provider}'. Valid providers are: ${VALID_PROVIDERS.join(', ')}.`);
      }
    }
  }
  if ('model' in config) {
    if (typeof config.model !== 'string' || config.model.trim().length === 0) {
      errors.push('model must be a non-empty string.');
    }
  }

  // MODEL-2: opencode model must be in <provider>/<model> format.
  if (config.cliTool === 'opencode' && 'model' in config) {
    if (typeof config.model === 'string' && !config.model.includes('/')) {
      errors.push('opencode model must be in <provider>/<model> format (e.g. vllm-local/nvidia/model-name).');
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  resolveStageModelConfig,
  validateStageModelConfig,
  VALID_PROVIDERS,
  VALID_CLI_TOOLS,
};
