'use strict';

/**
 * Tests for MODEL-1 — ModelConfigResolver
 * node:test + assert
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');

const {
  resolveStageModelConfig,
  validateStageModelConfig,
  VALID_PROVIDERS,
  VALID_CLI_TOOLS,
} = require('../src/services/modelConfigResolver');

// ---------------------------------------------------------------------------
// resolveStageModelConfig
// ---------------------------------------------------------------------------

describe('resolveStageModelConfig', () => {
  const agentId   = 'senior-architect';
  const agentSpec = { model: 'claude-opus-4-5', spawnArgs: [] };

  it('returns frontmatter defaults when no overrides are set', () => {
    const result = resolveStageModelConfig(agentId, agentSpec, null, null, null);
    assert.equal(result.model,        'claude-opus-4-5');
    assert.equal(result.provider,     'claude');
    assert.equal(result.cliTool,      'claude');
    assert.equal(result.resolvedFrom, 'frontmatter');
  });

  it('uses fallback model when agentSpec has no model', () => {
    const result = resolveStageModelConfig(agentId, null, null, null, null);
    assert.equal(result.model,        'claude-sonnet-4-5');
    assert.equal(result.resolvedFrom, 'frontmatter');
  });

  it('applies global settings override', () => {
    const settings = {
      pipeline: {
        stageModels: {
          [agentId]: { provider: 'claude', model: 'claude-haiku-4-5', cliTool: 'claude' },
        },
      },
    };
    const result = resolveStageModelConfig(agentId, agentSpec, settings, null, null);
    assert.equal(result.model,        'claude-haiku-4-5');
    assert.equal(result.resolvedFrom, 'settings');
  });

  it('space override takes priority over settings', () => {
    const settings = {
      pipeline: {
        stageModels: {
          [agentId]: { model: 'claude-haiku-4-5' },
        },
      },
    };
    const spaceModels = {
      [agentId]: { provider: 'claude', model: 'claude-sonnet-4-5', cliTool: 'claude' },
    };
    const result = resolveStageModelConfig(agentId, agentSpec, settings, spaceModels, null);
    assert.equal(result.model,        'claude-sonnet-4-5');
    assert.equal(result.resolvedFrom, 'space');
  });

  it('task override takes priority over space and settings', () => {
    const settings = {
      pipeline: { stageModels: { [agentId]: { model: 'model-A' } } },
    };
    const spaceModels = { [agentId]: { model: 'model-B' } };
    const taskModels  = { [agentId]: { provider: 'openai', model: 'gpt-4o', cliTool: 'custom' } };
    const result = resolveStageModelConfig(agentId, agentSpec, settings, spaceModels, taskModels);
    assert.equal(result.model,        'gpt-4o');
    assert.equal(result.provider,     'openai');
    assert.equal(result.cliTool,      'custom');
    assert.equal(result.resolvedFrom, 'task');
  });

  it('does not apply settings override for a different agent', () => {
    const settings = {
      pipeline: { stageModels: { 'developer-agent': { model: 'other-model' } } },
    };
    const result = resolveStageModelConfig(agentId, agentSpec, settings, null, null);
    assert.equal(result.model,        'claude-opus-4-5');
    assert.equal(result.resolvedFrom, 'frontmatter');
  });

  it('falls back to defaults for missing fields in override', () => {
    const settings = {
      pipeline: { stageModels: { [agentId]: { model: 'my-model' } } },
    };
    const result = resolveStageModelConfig(agentId, agentSpec, settings, null, null);
    assert.equal(result.model,    'my-model');
    assert.equal(result.provider, 'claude'); // default preserved
    assert.equal(result.cliTool,  'claude'); // default preserved
  });
});

// ---------------------------------------------------------------------------
// validateStageModelConfig
// ---------------------------------------------------------------------------

describe('validateStageModelConfig', () => {
  it('passes for a valid full config', () => {
    const result = validateStageModelConfig({ provider: 'claude', model: 'claude-sonnet-4-5', cliTool: 'claude' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('passes for a partial config (only model)', () => {
    const result = validateStageModelConfig({ model: 'some-model' });
    assert.equal(result.valid, true);
  });

  it('fails for null input', () => {
    const result = validateStageModelConfig(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('fails for string input', () => {
    const result = validateStageModelConfig('claude');
    assert.equal(result.valid, false);
  });

  it('fails for invalid provider', () => {
    const result = validateStageModelConfig({ provider: 'gemini', model: 'x' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('provider'));
  });

  it('fails for empty model string', () => {
    const result = validateStageModelConfig({ model: '   ' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('model'));
  });

  it('fails for invalid cliTool', () => {
    const result = validateStageModelConfig({ cliTool: 'figma' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('cliTool'));
  });

  it('reports all errors for multiple invalid fields', () => {
    const result = validateStageModelConfig({ provider: 'bad', model: '', cliTool: 'bad' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('VALID_PROVIDERS includes expected values', () => {
    assert.ok(VALID_PROVIDERS.includes('claude'));
    assert.ok(VALID_PROVIDERS.includes('openai'));
    assert.ok(VALID_PROVIDERS.includes('ollama'));
    assert.ok(VALID_PROVIDERS.includes('custom'));
  });

  it('VALID_CLI_TOOLS includes expected values', () => {
    assert.ok(VALID_CLI_TOOLS.includes('claude'));
    assert.ok(VALID_CLI_TOOLS.includes('opencode'));
    assert.ok(VALID_CLI_TOOLS.includes('custom'));
  });
});
