/**
 * Unit tests for the MODEL-2 opencode-aware routing utilities:
 * buildStageModelConfig, localRoutingToStageModelsMap, isValidOpencodeModel.
 */

import { describe, it, expect } from 'vitest';
import {
  buildStageModelConfig,
  localRoutingToStageModelsMap,
  isValidOpencodeModel,
} from '../../src/utils/modelRouting';

describe('isValidOpencodeModel', () => {
  it('requires a provider/model slash', () => {
    expect(isValidOpencodeModel('vllm-local/qwen2.5-coder')).toBe(true);
    expect(isValidOpencodeModel('claude-sonnet-4-5')).toBe(false);
    expect(isValidOpencodeModel('')).toBe(false);
  });
});

describe('buildStageModelConfig', () => {
  it('builds a claude config by default', () => {
    expect(buildStageModelConfig('claude-opus-4-5')).toEqual({
      provider: 'claude', model: 'claude-opus-4-5', cliTool: 'claude',
    });
  });

  it('derives the opencode provider from the model prefix', () => {
    expect(buildStageModelConfig('vllm-local/qwen2.5-coder', 'opencode')).toEqual({
      provider: 'vllm-local', model: 'vllm-local/qwen2.5-coder', cliTool: 'opencode',
    });
  });

  it('falls back to "opencode" provider when the prefix is empty', () => {
    expect(buildStageModelConfig('/justmodel', 'opencode')).toEqual({
      provider: 'opencode', model: '/justmodel', cliTool: 'opencode',
    });
  });

  it('builds a custom config', () => {
    expect(buildStageModelConfig('some-model', 'custom')).toEqual({
      provider: 'custom', model: 'some-model', cliTool: 'custom',
    });
  });

  it('returns null for a blank model (clear override)', () => {
    expect(buildStageModelConfig('   ', 'opencode')).toBeNull();
    expect(buildStageModelConfig('', 'claude')).toBeNull();
  });

  it('trims the model string', () => {
    expect(buildStageModelConfig('  claude-haiku-4-5  ')?.model).toBe('claude-haiku-4-5');
  });
});

describe('localRoutingToStageModelsMap', () => {
  it('preserves per-agent cliTool', () => {
    const map = localRoutingToStageModelsMap({
      'senior-architect': { model: 'claude-opus-4-5', cliTool: 'claude' },
      'developer-agent':  { model: 'vllm-local/qwen2.5-coder', cliTool: 'opencode' },
    });
    expect(map['senior-architect']).toEqual({
      provider: 'claude', model: 'claude-opus-4-5', cliTool: 'claude',
    });
    expect(map['developer-agent']).toEqual({
      provider: 'vllm-local', model: 'vllm-local/qwen2.5-coder', cliTool: 'opencode',
    });
  });

  it('maps a blank model to null (clear override)', () => {
    const map = localRoutingToStageModelsMap({
      'qa-engineer-e2e': { model: '', cliTool: 'opencode' },
    });
    expect(map['qa-engineer-e2e']).toBeNull();
  });
});
