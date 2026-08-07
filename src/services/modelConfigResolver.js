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
const VALID_CLI_TOOLS = ['claude', 'opencode', 'pi', 'hermes', 'custom'];
// cliTools whose model string must be in <provider>/<model> format (like opencode).
const SLASH_MODEL_CLI_TOOLS = ['opencode', 'pi', 'hermes'];

// Placeholders allowed inside a 'custom' command template. 'binary' is
// deliberately absent — the template IS the full executable command.
const VALID_CUSTOM_PLACEHOLDERS = ['{model}', '{prompt}', '{log}', '{done}'];

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
    command:  null,
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
    command:      current.command  || null,
    fallback:     current.fallback || null,
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
    if (config.cliTool === 'opencode' || config.cliTool === 'pi' || config.cliTool === 'hermes' || config.cliTool === 'custom') {
      // opencode / pi / hermes / custom: providers are user-defined — accept any non-empty string.
      // 'custom' is a working harness (arbitrary command template), not a placeholder.
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

  // MODEL-2/3: opencode/pi/hermes model must be in <provider>/<model> format.
  if (SLASH_MODEL_CLI_TOOLS.includes(config.cliTool) && 'model' in config) {
    if (typeof config.model === 'string' && !config.model.includes('/')) {
      errors.push(`${config.cliTool} model must be in <provider>/<model> format (e.g. gb10/deepseek-v4-flash).`);
    }
  }

  // MODEL-3: 'custom' cliTool requires a command template.
  if (config.cliTool === 'custom') {
    if (typeof config.command !== 'string' || config.command.trim().length === 0) {
      errors.push('custom cliTool requires a non-empty command template.');
    } else {
      // Validate that only known placeholders appear (if any braces exist).
      const braceMatch = config.command.match(/\{[a-zA-Z_]+\}/g) || [];
      for (const m of braceMatch) {
        if (!VALID_CUSTOM_PLACEHOLDERS.includes(m)) {
          errors.push(`Unknown placeholder '${m}' in custom command. Valid: ${VALID_CUSTOM_PLACEHOLDERS.join(', ')}.`);
        }
      }
    }
  } else if ('command' in config && config.command !== null) {
    errors.push("The 'command' field is only valid for cliTool 'custom'.");
  }

  // MODEL-3: fallback — optional { cliTool, model } that replaces the primary on
  // binary health-check failure.
  if ('fallback' in config && config.fallback !== null && config.fallback !== undefined) {
    const fb = config.fallback;
    if (typeof fb !== 'object' || Array.isArray(fb)) {
      errors.push('fallback must be an object { cliTool, model } or null.');
    } else {
      if (typeof fb.cliTool !== 'string' || !VALID_CLI_TOOLS.includes(fb.cliTool)) {
        errors.push(`Invalid fallback.cliTool '${fb.cliTool}'. Valid CLI tools are: ${VALID_CLI_TOOLS.join(', ')}.`);
      }
      if (fb.cliTool && SLASH_MODEL_CLI_TOOLS.includes(fb.cliTool) && 'model' in fb && typeof fb.model === 'string' && fb.model.trim().length > 0 && !fb.model.includes('/')) {
        errors.push(`fallback ${fb.cliTool} model must be in <provider>/<model> format.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  resolveStageModelConfig,
  validateStageModelConfig,
  VALID_PROVIDERS,
  VALID_CLI_TOOLS,
  SLASH_MODEL_CLI_TOOLS,
};
