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
  it('VALID_PROVIDERS contains claude', () => {
    assert.ok(VALID_PROVIDERS.includes('claude'));
  });

  it('VALID_CLI_TOOLS contains claude, opencode, pi, hermes, custom', () => {
    assert.deepEqual(VALID_CLI_TOOLS, ['claude', 'opencode', 'pi', 'hermes', 'custom']);
  });

  it('accepts opencode as a valid cliTool', () => {
    assert.equal(validateStageModelConfig({ cliTool: 'opencode' }).valid, true);
  });

  it('rejects openai provider for claude cliTool (still whitelisted)', () => {
    assert.equal(validateStageModelConfig({ provider: 'openai', model: 'gpt-4o' }).valid, false);
  });
});

// ---------------------------------------------------------------------------
// MODEL-2: opencode-specific validation
// ---------------------------------------------------------------------------

describe('validateStageModelConfig — opencode', () => {
  it('accepts opencode with provider/model format', () => {
    const result = validateStageModelConfig({
      cliTool: 'opencode',
      model:   'vllm-local/nvidia/Qwen3.6-35B',
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects opencode model without slash (not provider/model format)', () => {
    const result = validateStageModelConfig({
      cliTool: 'opencode',
      model:   'no-slash-model',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('provider>/<model'));
  });

  it('accepts opencode with any non-empty provider string', () => {
    const result = validateStageModelConfig({
      cliTool:  'opencode',
      provider: 'vllm-local',
      model:    'vllm-local/nvidia/Qwen3.6-35B',
    });
    assert.equal(result.valid, true);
  });

  it('rejects opencode with empty provider', () => {
    const result = validateStageModelConfig({
      cliTool:  'opencode',
      provider: '',
      model:    'vllm-local/nvidia/Qwen3.6-35B',
    });
    assert.equal(result.valid, false);
  });

  it('accepts opencode without model (no format constraint)', () => {
    const result = validateStageModelConfig({ cliTool: 'opencode' });
    assert.equal(result.valid, true);
  });

  it('claude provider whitelist still applies for non-opencode cliTool', () => {
    const result = validateStageModelConfig({ cliTool: 'claude', provider: 'gemini' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('provider'));
  });

  it('custom cliTool accepts any non-empty provider (not whitelisted)', () => {
    const result = validateStageModelConfig({
      cliTool:  'custom',
      provider: 'my-provider',
      command:  'my-tool --model {model} < {prompt} >> {log}',
    });
    assert.equal(result.valid, true, 'custom cliTool with non-claude provider should be valid');
  });

  it('full valid opencode config from blueprint example', () => {
    const result = validateStageModelConfig({
      cliTool:  'opencode',
      provider: 'vllm-local',
      model:    'vllm-local/nvidia/Qwen3.6-35B-A3B-NVFP4',
    });
    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// MODEL-3: pi-specific validation
// ---------------------------------------------------------------------------

describe('validateStageModelConfig — pi', () => {
  it('accepts pi as a valid cliTool', () => {
    assert.equal(validateStageModelConfig({ cliTool: 'pi' }).valid, true);
  });

  it('accepts pi with provider/model format', () => {
    const result = validateStageModelConfig({
      cliTool: 'pi',
      model:   'gb10/deepseek-v4-flash',
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects pi model without slash (not provider/model format)', () => {
    const result = validateStageModelConfig({
      cliTool: 'pi',
      model:   'no-slash-model',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('provider>/<model'));
  });

  it('accepts pi with any non-empty provider string', () => {
    const result = validateStageModelConfig({
      cliTool:  'pi',
      provider: 'gb10',
      model:    'gb10/deepseek-v4-flash',
    });
    assert.equal(result.valid, true);
  });

  it('rejects pi with empty provider', () => {
    const result = validateStageModelConfig({
      cliTool:  'pi',
      provider: '',
      model:    'gb10/deepseek-v4-flash',
    });
    assert.equal(result.valid, false);
  });
});

// ---------------------------------------------------------------------------
// MODEL-3: hermes validation
// ---------------------------------------------------------------------------

describe('validateStageModelConfig — hermes', () => {
  it('accepts hermes as a valid cliTool', () => {
    assert.equal(validateStageModelConfig({ cliTool: 'hermes' }).valid, true);
  });

  it('accepts hermes with a plain model (no slash required)', () => {
    const result = validateStageModelConfig({
      cliTool: 'hermes',
      model:   'deepseek-v4-flash',
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts hermes with provider/model format', () => {
    const result = validateStageModelConfig({
      cliTool:  'hermes',
      provider: 'Local',
      model:    'Local/deepseek-v4-flash',
    });
    assert.equal(result.valid, true);
  });

  it('accepts hermes with any non-empty provider string', () => {
    const result = validateStageModelConfig({
      cliTool:  'hermes',
      provider: 'Local',
      model:    'deepseek-v4-flash',
    });
    assert.equal(result.valid, true);
  });

  it('rejects hermes with empty provider', () => {
    const result = validateStageModelConfig({
      cliTool:  'hermes',
      provider: '',
      model:    'deepseek-v4-flash',
    });
    assert.equal(result.valid, false);
  });
});

// ---------------------------------------------------------------------------
// MODEL-3: custom cliTool validation
// ---------------------------------------------------------------------------

describe('validateStageModelConfig — custom', () => {
  it('accepts custom with a command template', () => {
    const result = validateStageModelConfig({
      cliTool:  'custom',
      provider: 'my-provider',
      command:  'my-tool --model {model} < {prompt} >> {log}',
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects custom without a command', () => {
    const result = validateStageModelConfig({ cliTool: 'custom' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('command'));
  });

  it('rejects custom with an empty command', () => {
    const result = validateStageModelConfig({ cliTool: 'custom', command: '   ' });
    assert.equal(result.valid, false);
  });

  it('rejects custom with an unknown placeholder', () => {
    const result = validateStageModelConfig({
      cliTool:  'custom',
      command:  'my-tool --bogus {nonexistent}',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Unknown placeholder'));
  });

  it('rejects the removed {binary} placeholder as unknown', () => {
    const result = validateStageModelConfig({
      cliTool:  'custom',
      command:  '{binary} --model {model}',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Unknown placeholder'));
  });

  it('rejects command field on non-custom cliTools', () => {
    const result = validateStageModelConfig({ cliTool: 'claude', command: 'echo hi' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('only valid for cliTool')));
  });
});

// ---------------------------------------------------------------------------
// MODEL-3: fallback validation
// ---------------------------------------------------------------------------

describe('validateStageModelConfig — fallback', () => {
  it('accepts a valid fallback object', () => {
    const result = validateStageModelConfig({
      cliTool:  'pi',
      provider: 'gb10',
      model:    'gb10/deepseek-v4-flash',
      fallback: { cliTool: 'claude', model: 'claude-sonnet-4-5' },
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts fallback: null (explicit disable)', () => {
    const result = validateStageModelConfig({ cliTool: 'pi', fallback: null });
    assert.equal(result.valid, true);
  });

  it('rejects a non-object fallback', () => {
    const result = validateStageModelConfig({ cliTool: 'pi', fallback: 'claude' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('fallback'));
  });

  it('rejects a fallback with an invalid cliTool', () => {
    const result = validateStageModelConfig({
      cliTool: 'pi',
      fallback: { cliTool: 'not-a-tool' },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('fallback.cliTool'));
  });

  it('rejects a fallback pi/opencode model without slash', () => {
    const result = validateStageModelConfig({
      cliTool: 'claude',
      fallback: { cliTool: 'pi', model: 'no-slash' },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('provider>/<model')));
  });
});
