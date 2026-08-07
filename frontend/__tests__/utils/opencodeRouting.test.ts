/**
 * Unit tests for the MODEL-2 opencode-aware routing utilities:
 * buildStageModelConfig, localRoutingToStageModelsMap, isValidOpencodeModel.
 */

import { describe, it, expect } from 'vitest';
import {
  buildStageModelConfig,
  buildFallbackConfig,
  localRoutingToStageModelsMap,
  isValidOpencodeModel,
  isValidSlashModel,
  isSlashModelHarness,
} from '../../src/utils/modelRouting';

describe('isValidOpencodeModel', () => {
  it('requires a provider/model slash', () => {
    expect(isValidOpencodeModel('vllm-local/qwen2.5-coder')).toBe(true);
    expect(isValidOpencodeModel('claude-sonnet-4-5')).toBe(false);
    expect(isValidOpencodeModel('')).toBe(false);
  });
});

describe('isSlashModelHarness / isValidSlashModel', () => {
  it('marks opencode, pi and hermes as slash-model harnesses', () => {
    expect(isSlashModelHarness('opencode')).toBe(true);
    expect(isSlashModelHarness('pi')).toBe(true);
    expect(isSlashModelHarness('hermes')).toBe(true);
    expect(isSlashModelHarness('claude')).toBe(false);
    expect(isSlashModelHarness('custom')).toBe(false);
  });

  it('isValidSlashModel requires provider/model', () => {
    expect(isValidSlashModel('gb10/deepseek-v4-flash')).toBe(true);
    expect(isValidSlashModel('deepseek-v4-flash')).toBe(false);
  });
});

describe('buildStageModelConfig', () => {
  it('builds a claude config by default', () => {
    expect(buildStageModelConfig('claude-opus-4-5')).toEqual({
      provider: 'claude', model: 'claude-opus-4-5', cliTool: 'claude',
    });
  });

  it('builds an opencode config with provider derived from the model prefix', () => {
    expect(buildStageModelConfig('vllm-local/qwen2.5-coder', 'opencode')).toEqual({
      provider: 'vllm-local', model: 'vllm-local/qwen2.5-coder', cliTool: 'opencode',
    });
  });

  it('builds a pi config with provider derived from the model prefix', () => {
    expect(buildStageModelConfig('gb10/deepseek-v4-flash', 'pi')).toEqual({
      provider: 'gb10', model: 'gb10/deepseek-v4-flash', cliTool: 'pi',
    });
  });

  it('builds a hermes config with provider derived from the model prefix', () => {
    expect(buildStageModelConfig('local/deepseek-v4-flash', 'hermes')).toEqual({
      provider: 'local', model: 'local/deepseek-v4-flash', cliTool: 'hermes',
    });
  });

  it('attaches a fallback harness to the config', () => {
    expect(buildStageModelConfig('claude-sonnet-4-5', 'claude', {
      cliTool: 'opencode', model: 'gb10/deepseek-v4-flash',
    })).toEqual({
      provider: 'claude', model: 'claude-sonnet-4-5', cliTool: 'claude',
      fallback: { cliTool: 'opencode', model: 'gb10/deepseek-v4-flash', provider: 'gb10' },
    });
  });

  it('falls back to the harness name when the provider prefix is empty', () => {
    expect(buildStageModelConfig('/justmodel', 'opencode')).toEqual({
      provider: 'opencode', model: '/justmodel', cliTool: 'opencode',
    });
    expect(buildStageModelConfig('/justmodel', 'hermes')).toEqual({
      provider: 'hermes', model: '/justmodel', cliTool: 'hermes',
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

describe('buildFallbackConfig', () => {
  it('returns null when unset', () => {
    expect(buildFallbackConfig(undefined)).toBeNull();
    expect(buildFallbackConfig(null)).toBeNull();
  });

  it('builds a claude fallback with a model', () => {
    expect(buildFallbackConfig({ cliTool: 'claude', model: 'claude-haiku-4-5' })).toEqual({
      cliTool: 'claude', model: 'claude-haiku-4-5',
    });
  });

  it('derives the provider for a slash-model fallback harness', () => {
    expect(buildFallbackConfig({ cliTool: 'hermes', model: 'local/deepseek-v4-flash' })).toEqual({
      cliTool: 'hermes', model: 'local/deepseek-v4-flash', provider: 'local',
    });
  });

  it('returns only cliTool when the model is blank', () => {
    expect(buildFallbackConfig({ cliTool: 'pi', model: '' })).toEqual({ cliTool: 'pi' });
  });
});
